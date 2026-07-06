/* PsicoLab - migration: let the blocked_ips hit counter decay over time.
   Run this ONCE in the D1 console, after 0005_security_hardening.sql.
   Paste-safe: no line comments, so it survives being collapsed to one line. */

ALTER TABLE blocked_ips ADD COLUMN last_hit_at INTEGER NOT NULL DEFAULT 0;
