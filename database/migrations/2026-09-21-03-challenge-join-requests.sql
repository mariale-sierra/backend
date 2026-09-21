-- 2026-09-21-03-challenge-join-requests.sql
--
-- Real, confirmed bug (reported live: "I tried making a private challenge,
-- joined from another account, and there was no request — I was immediately
-- in the challenge"): `ChallengesService.joinChallenge` always inserted
-- directly into `challenge_user_map`, regardless of `challenges.visibility`
-- — there was never a request-to-join concept for challenges at all. The
-- frontend (Manage-challenge's "Join requests" row, the join-requests
-- screen) was built entirely against endpoints that don't exist on this
-- backend, which is also why opening that screen showed a "not found" toast.
--
-- Exactly the same shape as `space_join_requests`
-- (2026-09-02-01-spaces-join-requests-and-activity-category.sql) — a
-- separate table from `challenge_user_map`, not an overload of it, same
-- reasoning: a pending request and an actual membership are different
-- things kept apart, same as `challenge_invites` already sits next to
-- `challenge_user_map`.

DO $$
BEGIN
  CREATE TYPE havit.challenge_join_request_status_enum AS ENUM (
    'pending',
    'approved',
    'rejected',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS havit.challenge_join_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  challenge_id UUID NOT NULL,
  user_id UUID NOT NULL,
  status havit.challenge_join_request_status_enum NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at TIMESTAMP,
  responded_by_user_id UUID,
  CONSTRAINT fk_challenge_join_requests_challenge
    FOREIGN KEY (challenge_id) REFERENCES havit.challenges (id) ON DELETE CASCADE,
  CONSTRAINT fk_challenge_join_requests_user
    FOREIGN KEY (user_id) REFERENCES havit.users (id) ON DELETE CASCADE,
  CONSTRAINT fk_challenge_join_requests_responded_by
    FOREIGN KEY (responded_by_user_id) REFERENCES havit.users (id) ON DELETE SET NULL
);
COMMENT ON TABLE havit.challenge_join_requests IS 'Solicitudes de ingreso a challenges privados, pendientes de aprobacion del owner.';

-- Same reasoning as uq_space_join_request_pending / uq_challenge_invite_pending: a
-- partial unique index, not an application-level check, so a race between two
-- "request to join" calls from the same user for the same challenge can't create
-- two pending rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_challenge_join_request_pending
  ON havit.challenge_join_requests (challenge_id, user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_challenge_join_requests_challenge_id
  ON havit.challenge_join_requests (challenge_id);

CREATE INDEX IF NOT EXISTS idx_challenge_join_requests_user_id
  ON havit.challenge_join_requests (user_id);
