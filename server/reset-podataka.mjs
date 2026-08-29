// Priprema za rad: briše probne podatke, zadržava katalog i podešavanja.
// Pokretanje:  node reset-podataka.mjs
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const DATA = path.join(import.meta.dirname, "data");
const DB = path.join(DATA, "crit.db");

// bezbednosna kopija pre bilo kakvog brisanja
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const backup = path.join(DATA, "backups", `pre-reset-${stamp}.db`);
fs.mkdirSync(path.dirname(backup), { recursive: true });

const db = new DatabaseSync(DB);
db.exec(`VACUUM INTO '${backup.replace(/\\/g, "/").replace(/'/g, "''")}'`);
console.log("kopija pre brisanja:", path.basename(backup));

const before = {};
const count = (t) => { try { return db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c; } catch { return 0; } };
for (const t of ["players", "sessions", "orders", "order_items", "transactions", "shifts", "logs"]) before[t] = count(t);

db.exec("PRAGMA foreign_keys = OFF;");
db.exec(`
  DELETE FROM order_items;
  DELETE FROM orders;
  DELETE FROM transactions;
  DELETE FROM sessions;
  DELETE FROM shifts;
  DELETE FROM logs;
  DELETE FROM players;
  DELETE FROM admin_tokens;
  DELETE FROM admins WHERE role <> 'owner' OR username <> 'admin';
  UPDATE computers SET status='offline', current_player_id=NULL, current_session_id=NULL, last_seen=NULL;
  DELETE FROM sqlite_sequence WHERE name IN
    ('players','sessions','orders','order_items','transactions','shifts','logs');
`);
db.exec("PRAGMA foreign_keys = ON;");
db.exec("VACUUM;");

console.log("\nobrisano:");
for (const [t, n] of Object.entries(before)) if (n) console.log(`  ${t.padEnd(14)} ${n}`);

console.log("\nzadržano:");
for (const t of ["computers", "shop_items", "games", "tools", "admins", "settings"]) {
  console.log(`  ${t.padEnd(14)} ${count(t)}`);
}
const imgs = db.prepare("SELECT COUNT(*) c FROM shop_items WHERE image IS NOT NULL").get().c;
console.log(`  slike artikala ${imgs}`);
console.log("\nSistem je spreman za rad.");
