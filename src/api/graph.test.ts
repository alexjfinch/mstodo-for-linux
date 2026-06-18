import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import {
  isValidGraphNextLink,
  validateListId,
  sanitizeAxiosError,
  fetchTaskLists,
  fetchTasksDelta,
  fetchAllTasksDelta,
  setTokenRefreshCallback,
  resetGraphCaches,
} from "./graph";

// Replace axios with a controllable spy so no real HTTP requests are made.
vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    isCancel: vi.fn(() => false),
  },
  AxiosError: Error,
}));

// Silence logger calls (which would otherwise try to reach the Tauri IPC bridge).
vi.mock("../services/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── helpers ───────────────────────────────────────────────────────────────────

function makeAxiosError(status: number, headers: Record<string, string> = {}) {
  return Object.assign(new Error(`HTTP ${status}`), {
    response: { status, headers, data: "" },
  });
}

const mockGet = vi.mocked(axios.get);

// ── isValidGraphNextLink ──────────────────────────────────────────────────────

describe("isValidGraphNextLink", () => {
  it("accepts a valid v1.0 URL", () => {
    expect(
      isValidGraphNextLink(
        "https://graph.microsoft.com/v1.0/me/todo/lists?$skiptoken=abc"
      )
    ).toBe(true);
  });

  it("accepts a valid beta URL", () => {
    expect(
      isValidGraphNextLink("https://graph.microsoft.com/beta/me/todo/lists")
    ).toBe(true);
  });

  it("returns false for undefined", () => {
    expect(isValidGraphNextLink(undefined)).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isValidGraphNextLink("")).toBe(false);
  });

  it("returns false for HTTP (not HTTPS)", () => {
    expect(
      isValidGraphNextLink("http://graph.microsoft.com/v1.0/me/todo/lists")
    ).toBe(false);
  });

  it("returns false for a wrong hostname", () => {
    expect(
      isValidGraphNextLink("https://evil.com/v1.0/me/todo/lists")
    ).toBe(false);
  });

  it("returns false for a subdomain spoof", () => {
    expect(
      isValidGraphNextLink(
        "https://graph.microsoft.com.evil.com/v1.0/me/todo/lists"
      )
    ).toBe(false);
  });

  it("returns false when path does not start with /v1.0/ or /beta/", () => {
    expect(
      isValidGraphNextLink("https://graph.microsoft.com/other/endpoint")
    ).toBe(false);
  });

  it("returns false for a relative URL", () => {
    expect(isValidGraphNextLink("/v1.0/me/todo/lists")).toBe(false);
  });

  it("returns false when a non-default port is specified", () => {
    expect(
      isValidGraphNextLink("https://graph.microsoft.com:8443/v1.0/me/todo/lists")
    ).toBe(false);
  });
});

// ── validateListId ────────────────────────────────────────────────────────────

describe("validateListId", () => {
  it("does not throw for a plain server-issued ID", () => {
    expect(() => validateListId("AQMkADAwATM0MDAAMS1j")).not.toThrow();
  });

  it("does not throw for an ID containing hyphens that does not start with 'local-'", () => {
    expect(() => validateListId("abc-def-ghi")).not.toThrow();
  });

  it("throws for an empty string", () => {
    expect(() => validateListId("")).toThrow(/Invalid listId/);
  });

  it("throws for an ID starting with 'local-'", () => {
    expect(() => validateListId("local-abc123")).toThrow(/Invalid listId/);
  });

  it("throws for the '__assigned__' sentinel value", () => {
    expect(() => validateListId("__assigned__")).toThrow(/Invalid listId/);
  });
});

// ── sanitizeAxiosError ────────────────────────────────────────────────────────

describe("sanitizeAxiosError", () => {
  it("returns non-object values unchanged", () => {
    expect(sanitizeAxiosError(null)).toBeNull();
    expect(sanitizeAxiosError("plain string")).toBe("plain string");
    expect(sanitizeAxiosError(42)).toBe(42);
  });

  it("returns a plain Error unchanged (no config property)", () => {
    const err = new Error("oops");
    const result = sanitizeAxiosError(err);
    expect(result).toBe(err);
  });

  it("removes the Authorization header from config.headers", () => {
    const err = {
      config: { headers: { Authorization: "Bearer secret-token", "Content-Type": "application/json" } },
    };
    sanitizeAxiosError(err);
    expect((err.config.headers as Record<string, unknown>)["Authorization"]).toBeUndefined();
    expect((err.config.headers as Record<string, unknown>)["Content-Type"]).toBe("application/json");
  });

  it("redacts a bearer token that leaked into response.data string", () => {
    const err = {
      response: { data: "error: Bearer eyJhbGc.eyJzdWI.SflKxwRJSMeKKF2QT4" },
    };
    sanitizeAxiosError(err);
    expect(err.response.data).toContain("[REDACTED]");
    expect(err.response.data).not.toContain("eyJhbGc");
  });

  it("redacts a bearer token that leaked into the message string", () => {
    const err = Object.assign(new Error("Request with Bearer eyJhbGc.payload.sig failed"), {
      config: { headers: {} },
    });
    sanitizeAxiosError(err);
    expect(err.message).toContain("[REDACTED]");
    expect(err.message).not.toContain("eyJhbGc");
  });

  it("leaves response.data alone when it is not a string", () => {
    const err = { response: { data: { code: "error" } } };
    sanitizeAxiosError(err);
    expect(err.response.data).toEqual({ code: "error" });
  });
});

// ── graphRequest — error-handling behaviour ───────────────────────────────────

describe("graphRequest error handling", () => {
  beforeEach(() => {
    resetGraphCaches();
    vi.clearAllMocks();
    setTokenRefreshCallback(null);
    vi.mocked(axios.isCancel).mockReturnValue(false);
  });

  afterEach(() => {
    setTokenRefreshCallback(null);
    vi.useRealTimers();
  });

  it("calls tokenRefreshCallback on 401 and retries with the new token", async () => {
    const refresh = vi.fn().mockResolvedValue("new-token");
    setTokenRefreshCallback(refresh);

    mockGet
      .mockRejectedValueOnce(makeAxiosError(401))
      .mockResolvedValueOnce({ data: { value: [] } });

    await fetchTaskLists("old-token");

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledTimes(2);
    // Second call must use the refreshed token
    const secondCallHeaders = (mockGet.mock.calls[1][1] as { headers: Record<string, string> }).headers;
    expect(secondCallHeaders.Authorization).toBe("Bearer new-token");
  });

  it("deduplicates concurrent 401 refresh calls — callback invoked only once", async () => {
    const refresh = vi.fn().mockResolvedValue("new-token");
    setTokenRefreshCallback(refresh);

    mockGet
      .mockRejectedValueOnce(makeAxiosError(401))
      .mockRejectedValueOnce(makeAxiosError(401))
      .mockResolvedValue({ data: { value: [] } });

    // Fire two requests that will both hit 401 simultaneously
    await Promise.all([fetchTaskLists("old-token"), fetchTaskLists("old-token")]);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("waits Retry-After seconds on 429 then retries", async () => {
    vi.useFakeTimers();

    mockGet
      .mockRejectedValueOnce(makeAxiosError(429, { "retry-after": "5" }))
      .mockResolvedValueOnce({ data: { value: [] } });

    const p = fetchTaskLists("token");
    await vi.advanceTimersByTimeAsync(5000);
    const result = await p;

    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(result).toEqual([]);
  });

  it("parses Retry-After as an HTTP-date and waits the correct duration", async () => {
    vi.useFakeTimers();

    const future = new Date(Date.now() + 10_000).toUTCString();
    mockGet
      .mockRejectedValueOnce(makeAxiosError(429, { "retry-after": future }))
      .mockResolvedValueOnce({ data: { value: [] } });

    const p = fetchTaskLists("token");
    await vi.advanceTimersByTimeAsync(11_000);
    await p;

    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it("defaults to 30 s Retry-After when the header is missing", async () => {
    vi.useFakeTimers();

    mockGet
      .mockRejectedValueOnce(makeAxiosError(429))
      .mockResolvedValueOnce({ data: { value: [] } });

    const p = fetchTaskLists("token");
    await vi.advanceTimersByTimeAsync(30_000);
    await p;

    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it("retries once after a 2-second delay on a 5xx error", async () => {
    vi.useFakeTimers();

    mockGet
      .mockRejectedValueOnce(makeAxiosError(503))
      .mockResolvedValueOnce({ data: { value: [] } });

    const p = fetchTaskLists("token");
    await vi.advanceTimersByTimeAsync(2000);
    await p;

    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it("re-throws immediately when axios.isCancel returns true", async () => {
    vi.mocked(axios.isCancel).mockReturnValue(true);
    const cancelErr = new Error("canceled");
    mockGet.mockRejectedValueOnce(cancelErr);

    await expect(fetchTaskLists("token")).rejects.toThrow("canceled");
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});

// ── fetchTasksDelta — pagination ──────────────────────────────────────────────

describe("fetchTasksDelta", () => {
  beforeEach(() => {
    resetGraphCaches();
    vi.clearAllMocks();
    vi.mocked(axios.isCancel).mockReturnValue(false);
  });

  it("returns changes and deltaLink from a single-page response", async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        value: [{ id: "t1", title: "Buy milk", status: "notStarted", importance: "normal" }],
        "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta-link",
      },
    });

    const result = await fetchTasksDelta("list-1", "token", null);

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].task.id).toBe("t1");
    expect(result.changes[0].removed).toBe(false);
    expect(result.deltaLink).toBe("https://graph.microsoft.com/v1.0/delta-link");
  });

  it("marks items with @removed as removed changes", async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        value: [{ id: "t1", title: "", "@removed": { reason: "deleted" } }],
        "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta-link",
      },
    });

    const result = await fetchTasksDelta("list-1", "token", null);

    expect(result.changes[0].removed).toBe(true);
    expect(result.changes[0].task.id).toBe("t1");
  });

  it("uses the provided deltaLink URL for incremental fetches", async () => {
    const deltaLink = "https://graph.microsoft.com/v1.0/me/todo/lists/list-1/tasks/delta?$deltatoken=abc";
    mockGet.mockResolvedValueOnce({
      data: { value: [], "@odata.deltaLink": deltaLink },
    });

    await fetchTasksDelta("list-1", "token", deltaLink);

    expect(mockGet.mock.calls[0][0]).toBe(deltaLink);
  });

  it("throws after exceeding the 50-page pagination limit", async () => {
    // Every page returns a nextLink but never a deltaLink, forcing infinite pagination
    mockGet.mockResolvedValue({
      data: {
        value: [],
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/next",
      },
    });

    await expect(fetchTasksDelta("list-1", "token", null)).rejects.toThrow(
      /exceeded.*pages/i
    );
  });
});

// ── fetchAllTasksDelta — fallback logic ───────────────────────────────────────

describe("fetchAllTasksDelta", () => {
  beforeEach(() => {
    resetGraphCaches();
    vi.clearAllMocks();
    vi.mocked(axios.isCancel).mockReturnValue(false);
  });

  const LIST_RESPONSE = {
    data: { value: [{ id: "list-1", displayName: "Inbox", isOwner: true, isShared: false }] },
  };
  const FLAGGED_LIST_RESPONSE = {
    data: {
      value: [
        { id: "list-1", displayName: "Inbox", isOwner: true, isShared: false },
        {
          id: "flagged-1",
          displayName: "Flagged Email",
          isOwner: true,
          isShared: false,
          wellknownListName: "flaggedEmails",
        },
      ],
    },
  };
  const DELTA_RESPONSE = {
    data: {
      value: [{ id: "t1", title: "Task", status: "notStarted", importance: "normal" }],
      "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta-link",
    },
  };
  const EMPTY_DELTA = {
    data: { value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta-link" },
  };

  it("skips lists with wellknownListName flaggedEmails", async () => {
    mockGet
      .mockResolvedValueOnce(FLAGGED_LIST_RESPONSE) // fetchTaskLists
      .mockResolvedValueOnce(EMPTY_DELTA);           // list-1 delta (flagged-1 is skipped)

    const { changes } = await fetchAllTasksDelta("token", {});

    // Only one delta call made (for list-1), flagged-1 never fetched
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(changes).toHaveLength(0);
  });

  it("falls back to full fetch when delta returns 400, adds list to unsupported cache", async () => {
    mockGet
      .mockResolvedValueOnce(LIST_RESPONSE)             // fetchTaskLists
      .mockRejectedValueOnce(makeAxiosError(400))       // delta endpoint → unsupported
      .mockResolvedValueOnce({ data: { value: [{ id: "t1", title: "T", status: "notStarted", importance: "normal" }] } }); // full fetch

    const { changes } = await fetchAllTasksDelta("token", {});

    expect(changes).toHaveLength(1);
    expect(changes[0].task.id).toBe("t1");
    // Second call for the same list should skip delta and go straight to full fetch
    mockGet.mockClear();
    mockGet
      .mockResolvedValueOnce(LIST_RESPONSE)
      .mockResolvedValueOnce({ data: { value: [] } });

    await fetchAllTasksDelta("token", {});
    // First call is fetchTaskLists, second is the full fetch (no delta attempt)
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it("performs a fresh full fetch when the delta token is expired (410)", async () => {
    const oldDeltaLink = "https://graph.microsoft.com/v1.0/old-delta";
    mockGet
      .mockResolvedValueOnce(LIST_RESPONSE)            // fetchTaskLists
      .mockRejectedValueOnce(makeAxiosError(410))      // old deltaLink → expired
      .mockResolvedValueOnce(DELTA_RESPONSE);          // fresh delta fetch

    const { changes, newDeltaTokens } = await fetchAllTasksDelta("token", {
      "list-1": oldDeltaLink,
    });

    expect(changes).toHaveLength(1);
    expect(newDeltaTokens["list-1"]).toBe("https://graph.microsoft.com/v1.0/delta-link");
  });

  it("accumulates changes from multiple lists", async () => {
    const twoLists = {
      data: {
        value: [
          { id: "list-1", displayName: "Inbox", isOwner: true, isShared: false },
          { id: "list-2", displayName: "Work", isOwner: true, isShared: false },
        ],
      },
    };
    const delta1 = {
      data: {
        value: [{ id: "t1", title: "T1", status: "notStarted", importance: "normal" }],
        "@odata.deltaLink": "https://graph.microsoft.com/v1.0/dl1",
      },
    };
    const delta2 = {
      data: {
        value: [{ id: "t2", title: "T2", status: "notStarted", importance: "normal" }],
        "@odata.deltaLink": "https://graph.microsoft.com/v1.0/dl2",
      },
    };

    mockGet
      .mockResolvedValueOnce(twoLists)
      .mockResolvedValueOnce(delta1)
      .mockResolvedValueOnce(delta2);

    const { changes, newDeltaTokens } = await fetchAllTasksDelta("token", {});

    expect(changes).toHaveLength(2);
    expect(newDeltaTokens["list-1"]).toBe("https://graph.microsoft.com/v1.0/dl1");
    expect(newDeltaTokens["list-2"]).toBe("https://graph.microsoft.com/v1.0/dl2");
  });
});
