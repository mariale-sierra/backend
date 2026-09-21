-- 2026-09-21-01-add-user-is-admin.sql
--
-- Global platform admin flag. Nothing in the schema had a concept of "admin"
-- before this — every existing permission check in the app is ownership
-- (assertOwnership: "is this yours") or plain membership, never a role above
-- that. Bloque 1's close-challenge and ban-user actions need one.
--
-- Same style as the existing `users.is_active` column (plain boolean,
-- default false — nobody is an admin until explicitly made one). There is no
-- self-service way to become an admin (by design: no endpoint sets this on
-- yourself) — the first admin is always granted by hand, directly against
-- the database:
--
--   UPDATE havit.users SET is_admin = true WHERE email = 'you@example.com';

ALTER TABLE havit.users
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
