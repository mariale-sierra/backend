-- Removes the presentation demo: its users and everything they made or that hangs off their challenges/spaces/chats.
SET search_path = havit, public;
CREATE TEMP TABLE demo_users ON COMMIT DROP AS SELECT unnest(ARRAY['d63d873b-cc9b-5424-b593-328be19fc4e8', '6229fb30-d7ad-5aa4-841e-b8536f14dfb3', 'aa4d293e-851c-5943-a1ed-f3f1afa447b2', '2742934a-ced9-57d0-a634-4338099ee102', '4a0ca4f3-e493-5e56-83f0-788e055ba8e3', 'aa9f3faa-a898-56bf-953e-55551be50449', '19ba4c03-9156-5097-8665-2e002acaf98a', '937f441f-2ced-5dab-86cc-eba53797e39d']::uuid[]) AS id;
CREATE TEMP TABLE demo_challenges ON COMMIT DROP AS SELECT id FROM challenges WHERE id = ANY(ARRAY['4be81057-8903-58cf-b41c-524c05d0a0eb', '8de05ecd-b1c4-5d32-88ad-0a315c5ebf4a', 'e2816108-4af1-5ec7-adaf-e49b745e3976', '2002cdb3-8c7a-55c6-9675-84754d830a61', 'afcfaff8-e341-58dd-aaaa-6aebef8ca0f2', 'a23a6d06-693f-5260-9ac9-94a1e3a6f295', '7ab5ac84-34b6-54ff-b594-6eadc8747102', 'a0a18a41-9d64-552d-a903-b7f707b3f249']::uuid[]) OR created_by_user_id IN (SELECT id FROM demo_users);
DELETE FROM notifications WHERE recipient_user_id IN (SELECT id FROM demo_users) OR actor_user_id IN (SELECT id FROM demo_users)
  OR related_entity_id IN (SELECT id::text FROM demo_challenges);
DELETE FROM direct_conversations WHERE id IN (SELECT direct_conversation_id FROM direct_conversation_members WHERE user_id IN (SELECT id FROM demo_users));
DELETE FROM workout_logs WHERE user_id IN (SELECT id FROM demo_users) OR challenge_id IN (SELECT id FROM demo_challenges);
DELETE FROM challenges WHERE id IN (SELECT id FROM demo_challenges);
DELETE FROM routines WHERE created_by_user_id IN (SELECT id FROM demo_users);
DELETE FROM spaces WHERE created_by_user_id IN (SELECT id FROM demo_users);
DELETE FROM users WHERE id IN (SELECT id FROM demo_users);
