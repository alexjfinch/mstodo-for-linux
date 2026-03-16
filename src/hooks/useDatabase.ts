import { useState, useEffect } from "react";
import { openDatabase } from "../api/sqlite";
import { initializeTables } from "../api/taskStorage";
import Database from "@tauri-apps/plugin-sql";
import { logger } from "../services/logger";

/**
 * Shared database hook - opens a single connection and initializes tables.
 * Both useTasks and useLists should consume this instead of opening their own connections.
 *
 * The connection is intentionally never closed — it lives for the app's lifetime.
 * Tauri's SQLite plugin handles cleanup on app exit. Closing in a useEffect cleanup
 * breaks under React StrictMode (double-mount) because Database.load returns a
 * shared pool that becomes unusable once closed.
 */
export const useDatabase = () => {
  const [db, setDb] = useState<Database | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const database = await openDatabase("tasks.db");
        await initializeTables(database);
        if (!cancelled) {
          setDb(database);
        }
      } catch (err) {
        logger.error("Failed to initialize database", err);
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to initialize database");
      } finally {
        if (!cancelled) setReady(true);
      }
    };
    init();
    return () => {
      cancelled = true;
    };
  }, []);

  return { db, ready, dbError: error };
};
