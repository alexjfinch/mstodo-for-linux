import { useState, useEffect, useRef } from "react";
import { openDatabase } from "../api/sqlite";
import { initializeTables } from "../api/taskStorage";
import Database from "@tauri-apps/plugin-sql";
import { logger } from "../services/logger";

/**
 * Shared database hook - opens a single connection and initializes tables.
 * Both useTasks and useLists should consume this instead of opening their own connections.
 */
export const useDatabase = () => {
  const [db, setDb] = useState<Database | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dbRef = useRef<Database | null>(null);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const database = await openDatabase("tasks.db");
        await initializeTables(database);
        if (!cancelled) {
          dbRef.current = database;
          setDb(database);
        } else {
          await database.close();
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
      if (dbRef.current) {
        dbRef.current.close().catch(() => {});
        dbRef.current = null;
      }
    };
  }, []);

  return { db, ready, dbError: error };
};
