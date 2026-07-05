/* PsicoLab - migration: brute-force lockout + scanner honeypot tracking.
   Run this ONCE in the D1 console, after 0004_profile_fields.sql.
   Paste-safe: no line comments, so it survives being collapsed to one line. */

ALTER TABLE users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users ADD COLUMN locked_until INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS blocked_ips (
  ip             TEXT PRIMARY KEY,
  reason         TEXT NOT NULL,
  hit_count      INTEGER NOT NULL DEFAULT 1,
  first_seen     TEXT NOT NULL DEFAULT (datetime('now')),
  blocked_until  INTEGER NOT NULL
);
