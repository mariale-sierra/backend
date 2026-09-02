-- 2026-09-02-01-spaces-join-requests-and-activity-category.sql
--
-- Bloque 2 (Spaces, Sprint 8): the init schema already ships `havit.spaces`,
-- `havit.space_members`, `space_visibility_enum` and `space_member_role_enum`
-- (section "8. SPACES / CHATS GRUPALES"), but no backend module ever read or
-- wrote them until now. Two things that schema doesn't cover yet, both
-- required by the actual Spaces wireframes (Chats-46A/47C/47E):
--
-- 1. Private spaces need a request-to-join + owner-approval flow (47C's
--    "Private — People must request to join, you approve", 47E's
--    "Join requests" screen). `space_members` has no "pending" concept at
--    all (only role/joined_at/is_active), so a separate table is added —
--    same shape/reasoning as `challenge_invites` next to
--    `challenge_user_map`: requests and actual memberships are kept apart
--    instead of overloading one table with both meanings.
-- 2. The "Activity Color" picker (47C) — Strength/Cardio Intense/Cardio
--    Low/Flexibility/Mind-Body/Functional — is exactly the taxonomy already
--    seeded in `exercise_categories` for challenges (see
--    2026-07-17-01-seed-exercise-categories-locations-metrics.sql), so
--    `spaces` gets an FK to it instead of a duplicate enum. Nullable: a
--    space without a chosen category falls back to the app's neutral accent,
--    same rule already used for a challenge with no dominant category.

ALTER TABLE havit.spaces
  ADD COLUMN IF NOT EXISTS activity_category_id BIGINT;

DO $$
BEGIN
  ALTER TABLE havit.spaces
    ADD CONSTRAINT fk_spaces_activity_category
      FOREIGN KEY (activity_category_id)
      REFERENCES havit.exercise_categories (id)
      ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- `spaces.created_by_user_id` had no index — every "spaces I own" lookup
-- (edit/delete/manage-join-requests authorization checks) would otherwise
-- scan the whole table.
CREATE INDEX IF NOT EXISTS idx_spaces_created_by_user_id
  ON havit.spaces (created_by_user_id);

DO $$
BEGIN
  CREATE TYPE havit.space_join_request_status_enum AS ENUM (
    'pending',
    'approved',
    'rejected',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS havit.space_join_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  space_id UUID NOT NULL,
  user_id UUID NOT NULL,
  status havit.space_join_request_status_enum NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at TIMESTAMP,
  responded_by_user_id UUID,
  CONSTRAINT fk_space_join_requests_space
    FOREIGN KEY (space_id) REFERENCES havit.spaces (id) ON DELETE CASCADE,
  CONSTRAINT fk_space_join_requests_user
    FOREIGN KEY (user_id) REFERENCES havit.users (id) ON DELETE CASCADE,
  CONSTRAINT fk_space_join_requests_responded_by
    FOREIGN KEY (responded_by_user_id) REFERENCES havit.users (id) ON DELETE SET NULL
);
COMMENT ON TABLE havit.space_join_requests IS 'Solicitudes de ingreso a spaces privados, pendientes de aprobacion del owner.';

-- Same pattern as uq_challenge_invite_pending: a partial unique index instead
-- of an application-level check, so a race between two "request to join"
-- calls from the same user for the same space can't create two pending rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_space_join_request_pending
  ON havit.space_join_requests (space_id, user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_space_join_requests_space_id
  ON havit.space_join_requests (space_id);
