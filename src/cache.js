import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

// Une transaction finalisée ne change jamais : on la garde pour toujours.
export class Cache {
  constructor(dir) {
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(path.join(dir, 'cache.db'));
    this.db.exec('PRAGMA busy_timeout = 10000; PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS tx (sig TEXT PRIMARY KEY, json TEXT NOT NULL)');
    this.getStmt = this.db.prepare('SELECT json FROM tx WHERE sig = ?');
    this.putStmt = this.db.prepare('INSERT OR REPLACE INTO tx (sig, json) VALUES (?, ?)');
  }
  get(sig) {
    const row = this.getStmt.get(sig);
    return row ? JSON.parse(row.json) : null;
  }
  put(sig, value) {
    this.putStmt.run(sig, JSON.stringify(value));
  }

  // Créateurs déjà vus dans les transactions en cache : créateur -> ensemble des tokens qu'il a créés.
  creators() {
    const out = new Map();
    for (const row of this.db.prepare(`SELECT json FROM tx WHERE json LIKE '%"create":{"mint"%'`).all()) {
      const t = JSON.parse(row.json);
      if (!t.create) continue;
      if (!out.has(t.feePayer)) out.set(t.feePayer, new Set());
      out.get(t.feePayer).add(t.create.mint);
    }
    return out;
  }

  // Autres données qui ne bougent plus une fois écrites (bougies de la première heure d'un vieux token, par exemple).
  getKv(key) {
    this.db.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, json TEXT NOT NULL)');
    const row = this.db.prepare('SELECT json FROM kv WHERE k = ?').get(key);
    return row ? JSON.parse(row.json) : null;
  }
  putKv(key, value) {
    this.db.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, json TEXT NOT NULL)');
    this.db.prepare('INSERT OR REPLACE INTO kv (k, json) VALUES (?, ?)').run(key, JSON.stringify(value));
  }
}
