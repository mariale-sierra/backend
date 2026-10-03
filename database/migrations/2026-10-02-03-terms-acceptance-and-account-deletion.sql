-- 2026-10-02-03-terms-acceptance-and-account-deletion.sql
--
-- B2 (seguridad/legal):
--  1. T&C / privacy-policy acceptance recorded at registration (when + which
--     version), and the 16+ age confirmation timestamp.
--  2. Account deletion: a user asks for deletion, the account stays
--     recoverable for a grace period (deletion_scheduled_for), then a job
--     purges personal data and anonymizes the users row.
--  3. account_deletion_audit: append-only trace of every request / cancel /
--     completion / failure. user_id deliberately has NO foreign key so the
--     trail survives whatever happens to the users row.
--
-- Existing users keep terms_accepted_at = NULL (they never accepted
-- anything); the API exposes that so the client can ask them to accept.

ALTER TABLE havit.users
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terms_version TEXT,
  ADD COLUMN IF NOT EXISTS age_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deletion_scheduled_for TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Backs the periodic "who is due for purge" lookup; partial so it stays
-- tiny (almost every user has deletion_scheduled_for IS NULL).
CREATE INDEX IF NOT EXISTS idx_users_deletion_scheduled_for
  ON havit.users (deletion_scheduled_for)
  WHERE deletion_scheduled_for IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS havit.account_deletion_audit (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID        NOT NULL,
  event        TEXT        NOT NULL
               CHECK (event IN ('requested', 'cancelled', 'completed', 'failed')),
  -- sha256 of the lowercased email at the time of the event: lets support
  -- confirm "was this address deleted" without keeping the address itself.
  email_sha256 TEXT,
  details      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_deletion_audit_user
  ON havit.account_deletion_audit (user_id, occurred_at);
