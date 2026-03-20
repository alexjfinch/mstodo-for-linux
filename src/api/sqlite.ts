import Database from "@tauri-apps/plugin-sql";

export async function openDatabase(name: string): Promise<Database> {
  const db = await Database.load(`sqlite:${name}`);
  // Enable foreign key enforcement — SQLite disables it by default per-connection
  await db.execute("PRAGMA foreign_keys = ON");
  return db;
}
