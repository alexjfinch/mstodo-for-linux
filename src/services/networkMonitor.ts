import { useSyncExternalStore } from "react";

const PING_URL = "https://graph.microsoft.com/v1.0/$metadata";
const PING_INTERVAL = 30_000; // Re-check every 30 seconds
const PING_TIMEOUT = 5_000;

/**
 * navigator.onLine is unreliable on Linux/WebKitGTK — it often returns true
 * even with no network. We use a lightweight HEAD request to Graph as the primary signal,
 * falling back to browser events for immediate transitions.
 */
async function probeNetwork(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT);
    const resp = await fetch(PING_URL, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    // Any HTTP response (even 4xx/5xx) means the network and Graph endpoint
    // are reachable. Only a fetch exception (timeout, DNS failure) means offline.
    return resp.status > 0;
  } catch {
    return false;
  }
}

// A single polling loop is shared across all consumers (useTasks, useLists, etc.)
// to avoid duplicate HEAD requests.

// Start as false — the first probe (fired immediately on start()) will set the real value.
// This prevents premature API calls when the app launches offline.
let isOnline = false;
let subscribers = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;

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

const handleOnline = () => { check(); };
const handleOffline = () => {
  if (isOnline) {
    isOnline = false;
    notify();
  }
};

// Immediately re-probe when waking from sleep or regaining focus
const handleVisibilityChange = () => {
  if (document.visibilityState === "visible") check();
};
const handleFocus = () => { check(); };

function start() {
  if (intervalId !== null) return;

  check();
  intervalId = setInterval(check, PING_INTERVAL);
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("focus", handleFocus);
}

function stop() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  window.removeEventListener("online", handleOnline);
  window.removeEventListener("offline", handleOffline);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  window.removeEventListener("focus", handleFocus);
}

function subscribe(cb: () => void) {
  subscribers.add(cb);
  start(); // ensure polling is running while there are subscribers
  return () => {
    subscribers.delete(cb);
    if (subscribers.size === 0) stop();
  };
}

function getSnapshot() {
  return isOnline;
}

export function useNetworkStatus() {
  return useSyncExternalStore(subscribe, getSnapshot);
}
