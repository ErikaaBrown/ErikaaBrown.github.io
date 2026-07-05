/* PsicoLab - migration: optional profile fields (display name, photo, bio).
   Run this ONCE in the D1 console, after 0003_professional_sharing.sql.
   Paste-safe: no line comments, so it survives being collapsed to one line.

   Unlike auth_hash/dek_pass_ct/etc, these three columns are stored in
   PLAIN TEXT, not end-to-end encrypted - they exist only so a patient and
   their connected professional can recognize each other, the same way the
   email column already is. Nothing here is sensitive clinical data. */

ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT '';

ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT '';

ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT '';
