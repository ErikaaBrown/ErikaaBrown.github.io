-- PsicoLab — esquema da base de dados D1
-- Executar uma vez na consola da D1 (dashboard da Cloudflare).

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT UNIQUE NOT NULL,
  auth_salt  TEXT NOT NULL,
  auth_hash  TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'user',   -- 'user' | 'professional' | 'admin' (fases futuras)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS blobs (
  user_id  INTEGER NOT NULL,
  tool     TEXT NOT NULL,       -- 'mood' | 'thoughts' | 'gratitude' | 'habits'
  iv       TEXT NOT NULL,       -- vector de inicialização AES-GCM (base64)
  ct       TEXT NOT NULL,       -- dados cifrados no browser (base64) — o servidor nunca vê o conteúdo
  updated  INTEGER NOT NULL,    -- timestamp (ms) da última escrita, para resolução de conflitos
  PRIMARY KEY (user_id, tool),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_blobs_user ON blobs(user_id);
