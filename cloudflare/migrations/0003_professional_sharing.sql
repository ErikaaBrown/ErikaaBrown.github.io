/* PsicoLab - migration: professional accounts and selective sharing.
   Run this ONCE in the D1 console, after 0002_recovery_codes.sql.
   Paste-safe: no line comments, so it survives being collapsed to one line. */

ALTER TABLE users ADD COLUMN professional_code TEXT;

ALTER TABLE users ADD COLUMN ecdh_pub TEXT NOT NULL DEFAULT '';

ALTER TABLE users ADD COLUMN ecdh_priv_pass_iv TEXT NOT NULL DEFAULT '';

ALTER TABLE users ADD COLUMN ecdh_priv_pass_ct TEXT NOT NULL DEFAULT '';

ALTER TABLE users ADD COLUMN ecdh_priv_recovery_iv TEXT NOT NULL DEFAULT '';

ALTER TABLE users ADD COLUMN ecdh_priv_recovery_ct TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_professional_code ON users(professional_code) WHERE professional_code IS NOT NULL;

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
