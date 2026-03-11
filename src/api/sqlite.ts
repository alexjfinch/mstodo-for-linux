// src/api/sqlite.ts
import Database from "@tauri-apps/plugin-sql";

/**
 * Open a SQLite database using the Tauri SQLite plugin v2
 * @param name - database filename (e.g., "tasks.db")
 * @returns Database instance with async methods
 */
export async function openDatabase(name: string): Promise<Database> {
  // The database path follows the format: sqlite:<filename>
  return await Database.load(`sqlite:${name}`);
}
