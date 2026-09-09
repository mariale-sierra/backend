-- 2026-09-08-02-temporarily-disable-post-moderation-gate.sql
--
-- Team decision (2026-09): the OpenAI account backing ModerationService is
-- quota-exhausted (confirmed 429 on every call), which left every workout
-- post stuck 'pending' forever — indistinguishable from "doesn't exist" to
-- any non-owner viewer, silently breaking "see anyone else's posts" app-wide.
-- The moderation gate is being flagged off in code (see
-- WorkoutPostsService.MODERATION_GATE_ENABLED) rather than removed, so it
-- can be switched back on later without resurrecting anything.
--
-- This is the one-time half of that: clear the existing backlog of posts
-- that got stuck 'pending' while the gate was still on, so they're visible
-- immediately once this deploys instead of waiting for the batch cron
-- (processPendingModerationBatch, 20 posts/10min) to cycle through however
-- many piled up during the outage. Going forward, new posts are approved
-- directly at creation while the gate stays off — this migration never
-- needs to run again.
UPDATE havit.workout_posts
SET moderation_status = 'approved',
    moderation_reason = 'Aprobado automáticamente: moderación por IA desactivada temporalmente por el equipo',
    moderated_at = now()
WHERE moderation_status = 'pending';
