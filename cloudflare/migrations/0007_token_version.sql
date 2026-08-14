/* PsicoLab - migration: session/token revocation support.
   Run this ONCE in the D1 console, after 0006_ip_flag_decay.sql.
   Paste-safe: no line comments, so it survives being collapsed to one line. */

ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
