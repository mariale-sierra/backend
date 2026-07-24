-- Challenge invites are listed by recipient (received/pending) and by sender
-- (sent) on every visit to the invitations screen. The base schema only has
-- the partial unique index on (challenge_id, sender, recipient), so both
-- listing queries would seq-scan. Safe to re-run (IF NOT EXISTS).

CREATE INDEX IF NOT EXISTS idx_challenge_invites_recipient
  ON havit.challenge_invites (recipient_user_id, status)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_challenge_invites_sender
  ON havit.challenge_invites (sender_user_id, status)
  WHERE is_active = TRUE;
