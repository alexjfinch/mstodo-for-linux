import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Store } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
import { setTokenRefreshCallback, resetGraphCaches } from "../api/graph";
import { logger } from "../services/logger";

/** Metadata stored in settings.json (no secrets). */
type AccountMeta = {
  id: string;
  displayName: string;
  email: string;
};

/** Runtime account with tokens loaded from the system keyring. */
export type StoredAccount = AccountMeta & {
  accessToken: string | null;
  refreshToken: string | null;
};

async function keyringSet(account: string, key: string, value: string) {
  await invoke("keyring_set", { account, key, value });
}

async function keyringGet(account: string, key: string): Promise<string | null> {
  return invoke<string | null>("keyring_get", { account, key });
}

async function keyringDelete(account: string, key: string) {
  await invoke("keyring_delete", { account, key });
}

async function storeTokens(id: string, accessToken: string, refreshToken: string) {
  await keyringSet(id, "access_token", accessToken);
  await keyringSet(id, "refresh_token", refreshToken);
}

async function loadTokens(id: string): Promise<{ accessToken: string | null; refreshToken: string | null }> {
  const [accessToken, refreshToken] = await Promise.all([
    keyringGet(id, "access_token"),
    keyringGet(id, "refresh_token"),
  ]);
  if (!accessToken && !refreshToken) {
    logger.warn(`No tokens found in keyring for account [redacted] — account may need re-authentication`);
  } else if (!accessToken || !refreshToken) {
    logger.warn(`Partial tokens found in keyring for account [redacted] — ${!accessToken ? "access" : "refresh"} token missing`);
  }
  return { accessToken: accessToken ?? null, refreshToken: refreshToken ?? null };
}

async function deleteTokens(id: string) {
  await Promise.all([
    keyringDelete(id, "access_token"),
    keyringDelete(id, "refresh_token"),
  ]);
}

export const useAuth = () => {
  const [accounts, setAccounts] = useState<StoredAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshTokenRef = useRef<string | null>(null);
  const activeAccountIdRef = useRef<string | null>(null);
  const consecutiveRefreshFailuresRef = useRef(0);

  const accountsRef = useRef<StoredAccount[]>([]);

  const activeAccount = useMemo(
    () => accounts.find((a) => a.id === activeAccountId) ?? null,
    [accounts, activeAccountId]
  );
  const accessToken = activeAccount?.accessToken ?? null;

  useEffect(() => { accountsRef.current = accounts; }, [accounts]);
  useEffect(() => { activeAccountIdRef.current = activeAccountId; }, [activeAccountId]);

  useEffect(() => {
    refreshTokenRef.current = activeAccount?.refreshToken ?? null;
  }, [activeAccount]);

  // Load accounts: metadata from settings.json, tokens from keyring
  useEffect(() => {
    (async () => {
      try {
        const store = await Store.load("settings.json");
        const storedMeta = await store.get<AccountMeta[]>("accounts");
        const activeId = await store.get<string>("active_account_id");

        if (storedMeta && storedMeta.length > 0) {
          const hydrated = await Promise.all(
            storedMeta.map(async (meta) => {
              const tokens = await loadTokens(meta.id);
              return { ...meta, ...tokens };
            })
          );

          setAccounts(hydrated);
          setActiveAccountId(activeId ?? storedMeta[0].id);
        }
      } catch (err) {
        logger.error("Failed to load accounts", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Persist account metadata (no tokens) to settings.json
  const persistAccounts = useCallback(async (accs: StoredAccount[], activeId: string | null) => {
    try {
      const store = await Store.load("settings.json");
      const meta: AccountMeta[] = accs.map(({ id, displayName, email }) => ({
        id, displayName, email,
      }));
      await store.set("accounts", meta);
      if (activeId) await store.set("active_account_id", activeId);
      await store.save();
    } catch (err) {
      logger.error("Failed to persist accounts", err);
      throw err; // Propagate so callers know the save failed (e.g. signOut may not have persisted)
    }
  }, []);

  const signOut = useCallback(async () => {
    if (!activeAccountId) return;
    await deleteTokens(activeAccountId);
    const remaining = accounts.filter((a) => a.id !== activeAccountId);
    const newActiveId = remaining.length > 0 ? remaining[0].id : null;
    setAccounts(remaining);
    setActiveAccountId(newActiveId);
    await persistAccounts(remaining, newActiveId);
  }, [activeAccountId, accounts, persistAccounts]);

  const refresh = useCallback(async (): Promise<string> => {
    const currentRefresh = refreshTokenRef.current;
    if (!currentRefresh) throw new Error("No refresh token available");

    // Use refs to avoid stale closures — refresh() may be called long after
    // the callback was created (e.g. on a 401 retry during account switch).
    const currentAccountId = activeAccountIdRef.current;
    if (!currentAccountId) throw new Error("No active account");

    try {
      const tokenResp = await invoke<{ access_token: string; refresh_token?: string }>(
        "refresh_token", { refreshToken: currentRefresh }
      );
      const newRefresh = tokenResp.refresh_token ?? currentRefresh;
      if (!tokenResp.refresh_token) {
        logger.warn("Token refresh response did not include a new refresh token — reusing existing one");
      }
      await storeTokens(currentAccountId, tokenResp.access_token, newRefresh);
      consecutiveRefreshFailuresRef.current = 0;
      const updated = accountsRef.current.map((a) =>
        a.id === currentAccountId
          ? { ...a, accessToken: tokenResp.access_token, refreshToken: newRefresh }
          : a
      );
      setAccounts(updated);
      await persistAccounts(updated, currentAccountId);
      return tokenResp.access_token;
    } catch (err) {
      logger.error("Refresh failed", err);
      // Only sign out on permanent failures (invalid_grant, interaction_required).
      // Transient errors (network timeouts, 5xx) should not force re-authentication.
      const errMsg = err instanceof Error ? err.message : String(err);
      const isPermanent = /invalid_grant|interaction_required|invalid_client|unauthorized_client|consent_required/.test(errMsg);
      consecutiveRefreshFailuresRef.current++;
      if (isPermanent || consecutiveRefreshFailuresRef.current >= 5) {
        if (!isPermanent) {
          logger.warn(`Token refresh failed ${consecutiveRefreshFailuresRef.current} consecutive times — forcing re-authentication`);
        } else {
          logger.warn("Permanent auth failure — signing out");
        }
        consecutiveRefreshFailuresRef.current = 0;
        await signOut();
      }
      throw err;
    }
  }, [signOut, persistAccounts]);

  // Register the refresh callback
  useEffect(() => {
    if (activeAccount?.refreshToken) {
      setTokenRefreshCallback(refresh);
    } else {
      setTokenRefreshCallback(null);
    }
    return () => setTokenRefreshCallback(null);
  }, [activeAccount?.refreshToken, refresh]);

  const signIn = useCallback(async () => {
    setLoading(true);
    try {
      const tokenResp = await invoke<{ access_token: string; refresh_token?: string }>("sign_in");

      const { fetchUserProfile } = await import("../api/graph");
      const profile = await fetchUserProfile(tokenResp.access_token);
      // Require a stable, unique identifier — displayName is not unique and could collide
      const accountId = profile.userPrincipalName || profile.mail;
      if (!accountId) {
        throw new Error("Sign-in failed: your Microsoft account profile does not include a userPrincipalName or email address. Please contact your administrator.");
      }

      // Store tokens in system keyring
      await storeTokens(accountId, tokenResp.access_token, tokenResp.refresh_token ?? "");

      const newAccount: StoredAccount = {
        id: accountId,
        displayName: profile.displayName,
        email: profile.mail || profile.userPrincipalName,
        accessToken: tokenResp.access_token,
        refreshToken: tokenResp.refresh_token ?? "",
      };

      const existing = accountsRef.current.filter((a) => a.id !== accountId);
      const updated = [...existing, newAccount];
      setAccounts(updated);
      setActiveAccountId(accountId);
      await persistAccounts(updated, accountId);
    } catch (err) {
      logger.error("Sign in failed", err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [persistAccounts]);

  const switchAccount = useCallback(async (accountId: string) => {
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return;
    // Reset graph-level caches eagerly so the new account gets a clean slate
    resetGraphCaches();
    setActiveAccountId(accountId);
    await persistAccounts(accounts, accountId);
  }, [accounts, persistAccounts]);

  const removeAccount = useCallback(async (accountId: string) => {
    await deleteTokens(accountId);
    const remaining = accounts.filter((a) => a.id !== accountId);
    let newActiveId = activeAccountId;
    if (activeAccountId === accountId) {
      newActiveId = remaining.length > 0 ? remaining[0].id : null;
    }
    setAccounts(remaining);
    setActiveAccountId(newActiveId);
    await persistAccounts(remaining, newActiveId);
  }, [activeAccountId, accounts, persistAccounts]);

  const updateAccountProfile = useCallback(async (
    accountId: string,
    profile: { displayName: string; email: string; newId?: string }
  ) => {
    // If the account ID is changing, migrate tokens in keyring
    if (profile.newId && profile.newId !== accountId) {
      const tokens = await loadTokens(accountId);
      if (tokens.accessToken || tokens.refreshToken) {
        await storeTokens(profile.newId, tokens.accessToken ?? "", tokens.refreshToken ?? "");
        await deleteTokens(accountId);
      }
    }

    const updated = accounts.map((a) => {
      if (a.id !== accountId) return a;
      return {
        ...a,
        id: profile.newId ?? a.id,
        displayName: profile.displayName,
        email: profile.email,
      };
    });
    const newActiveId = profile.newId && activeAccountId === accountId
      ? profile.newId
      : activeAccountId;
    setAccounts(updated);
    setActiveAccountId(newActiveId);
    await persistAccounts(updated, newActiveId);
  }, [activeAccountId, accounts, persistAccounts]);

  return {
    accessToken,
    loading,
    signIn,
    signOut,
    refresh,
    accounts,
    activeAccountId,
    switchAccount,
    removeAccount,
    updateAccountProfile,
  };
};
