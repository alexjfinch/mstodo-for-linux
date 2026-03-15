import { useSyncExternalStore } from "react";

const PING_URL = "https://graph.microsoft.com/v1.0/$metadata";
const PING_INTERVAL = 30_000; // Re-check every 30 seconds
const PING_TIMEOUT = 5_000;

/**
 * navigator.onLine is unreliable on Linux/WebKitGTK — it often returns true
 * even with no network. We use a lightweight HEAD request to Graph as the
 * primary signal, falling back to browser events for immediate transitions.
 */
async function probeNetwork(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT);
    await fetch(PING_URL, {
      method: "HEAD",
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}

// ── Shared singleton ────────────────────────────────────────────────
// A single polling loop is shared across all consumers (useTasks, useLists, etc.)
// to avoid duplicate HEAD requests.

let isOnline = true;
let subscribers = new Set<() => void>();
let started = false;

function notify() {
  for (const cb of subscribers) cb();
}

async function check() {
  const online = await probeNetwork();
  if (online !== isOnline) {
    isOnline = online;
    notify();
  }
}

function start() {
  if (started) return;
  started = true;

  check();
  const interval = setInterval(check, PING_INTERVAL);

  const handleOnline = () => { check(); };
  const handleOffline = () => {
    if (isOnline) {
      isOnline = false;
      notify();
    }
  };

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  // Cleanup is intentionally omitted — the monitor runs for the app's lifetime.
  // If needed in the future, store the interval/listeners for teardown.
  void interval;
}

function subscribe(cb: () => void) {
  start();
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}

function getSnapshot() {
  return isOnline;
}

export function useNetworkStatus() {
  return useSyncExternalStore(subscribe, getSnapshot);
}
