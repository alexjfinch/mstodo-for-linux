import Database from "@tauri-apps/plugin-sql";

export async function openDatabase(name: string): Promise<Database> {
  // The database is preloaded by the Rust side (plugins.sql.preload in tauri.conf.json),
  // so the webview only takes a handle to it. It is deliberately not granted
  // `sql:allow-load`, which would let it open any SQLite file by absolute path.
  const db = Database.get(`sqlite:${name}`);
  // Enable foreign key enforcement — SQLite disables it by default per-connection
  await db.execute("PRAGMA foreign_keys = ON");
  return db;
}
