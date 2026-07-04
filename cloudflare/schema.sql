/* PsicoLab - D1 database schema. Safe to paste into the D1 console
   (no line comments, so it works even if newlines are collapsed).
   Re-running is harmless thanks to IF NOT EXISTS. */

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT UNIQUE NOT NULL,
  auth_salt  TEXT NOT NULL,
  auth_hash  TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS blobs (
  user_id  INTEGER NOT NULL,
  tool     TEXT NOT NULL,
  iv       TEXT NOT NULL,
  ct       TEXT NOT NULL,
  updated  INTEGER NOT NULL,
  PRIMARY KEY (user_id, tool),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_blobs_user ON blobs(user_id);
