// src/api/sqlite.ts
import Database from "@tauri-apps/plugin-sql";

/**
 * Open a SQLite database using the Tauri SQLite plugin v2
 * @param name - database filename (e.g., "tasks.db")
 * @returns Database instance with async methods
 */
export async function openDatabase(name: string): Promise<Database> {
  // The database path follows the format: sqlite:<filename>
  const db = await Database.load(`sqlite:${name}`);
  // Enable foreign key enforcement — SQLite disables it by default per-connection
  await db.execute("PRAGMA foreign_keys = ON");
  return db;
}
