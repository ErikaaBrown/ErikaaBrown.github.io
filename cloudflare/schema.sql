/* PsicoLab - D1 database schema. Safe to paste into the D1 console
   (no line comments, so it works even if newlines are collapsed).
   Re-running is harmless thanks to IF NOT EXISTS.

   Already have this database from before? Do NOT re-paste this file -
   run the files in cloudflare/migrations/ instead, in order. They add
   the new columns/tables without touching your existing users and data. */

CREATE TABLE IF NOT EXISTS users (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  email                  TEXT UNIQUE NOT NULL,
  auth_salt              TEXT NOT NULL,
  auth_hash              TEXT NOT NULL,
  recovery_salt          TEXT NOT NULL DEFAULT '',
  recovery_hash          TEXT NOT NULL DEFAULT '',
  dek_pass_iv            TEXT NOT NULL DEFAULT '',
  dek_pass_ct            TEXT NOT NULL DEFAULT '',
  dek_recovery_iv        TEXT NOT NULL DEFAULT '',
  dek_recovery_ct        TEXT NOT NULL DEFAULT '',
  professional_code      TEXT,
  ecdh_pub               TEXT NOT NULL DEFAULT '',
  ecdh_priv_pass_iv      TEXT NOT NULL DEFAULT '',
  ecdh_priv_pass_ct      TEXT NOT NULL DEFAULT '',
  ecdh_priv_recovery_iv  TEXT NOT NULL DEFAULT '',
  ecdh_priv_recovery_ct  TEXT NOT NULL DEFAULT '',
  role                   TEXT NOT NULL DEFAULT 'user',
  display_name           TEXT NOT NULL DEFAULT '',
  avatar                 TEXT NOT NULL DEFAULT '',
  bio                    TEXT NOT NULL DEFAULT '',
  failed_logins          INTEGER NOT NULL DEFAULT 0,
  locked_until           INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_professional_code ON users(professional_code) WHERE professional_code IS NOT NULL;

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

CREATE TABLE IF NOT EXISTS connections (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id       INTEGER NOT NULL,
  professional_id  INTEGER NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (patient_id, professional_id),
  FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (professional_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_connections_patient ON connections(patient_id);

CREATE INDEX IF NOT EXISTS idx_connections_professional ON connections(professional_id);

CREATE TABLE IF NOT EXISTS shares (
  connection_id  INTEGER NOT NULL,
  category       TEXT NOT NULL,
  iv             TEXT NOT NULL,
  ct             TEXT NOT NULL,
  updated        INTEGER NOT NULL,
  PRIMARY KEY (connection_id, category),
  FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shares_connection ON shares(connection_id);

CREATE TABLE IF NOT EXISTS blocked_ips (
  ip             TEXT PRIMARY KEY,
  reason         TEXT NOT NULL,
  hit_count      INTEGER NOT NULL DEFAULT 1,
  first_seen     TEXT NOT NULL DEFAULT (datetime('now')),
  blocked_until  INTEGER NOT NULL
);
