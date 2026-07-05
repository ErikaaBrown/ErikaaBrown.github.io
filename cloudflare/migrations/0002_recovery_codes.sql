/* PsicoLab - migration: adds account recovery code support.
   Run this ONCE in the D1 console if your database already existed
   before this feature (i.e. you already ran the original schema.sql).
   Brand new databases: use schema.sql instead, it already includes
   these columns.

   Safe to run more than once accidentally: if a column already exists,
   that single ALTER statement fails with "duplicate column name" and
   you can just skip it and run the remaining ones. */

ALTER TABLE users ADD COLUMN recovery_salt TEXT NOT NULL DEFAULT '';

ALTER TABLE users ADD COLUMN recovery_hash TEXT NOT NULL DEFAULT '';

ALTER TABLE users ADD COLUMN dek_pass_iv TEXT NOT NULL DEFAULT '';

ALTER TABLE users ADD COLUMN dek_pass_ct TEXT NOT NULL DEFAULT '';

ALTER TABLE users ADD COLUMN dek_recovery_iv TEXT NOT NULL DEFAULT '';

ALTER TABLE users ADD COLUMN dek_recovery_ct TEXT NOT NULL DEFAULT '';
