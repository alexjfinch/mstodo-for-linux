import { useState, useEffect, useCallback, useRef } from "react";

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

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(true); // Assume online until proven otherwise
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const check = useCallback(async () => {
    const online = await probeNetwork();
    setIsOnline(online);
  }, []);

  useEffect(() => {
    // Initial check
    check();

    // Periodic re-check
    intervalRef.current = setInterval(check, PING_INTERVAL);

    // Browser events as supplementary signal (trigger an immediate re-check)
    const handleOnline = () => { check(); };
    const handleOffline = () => { setIsOnline(false); };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [check]);

  return isOnline;
}
