-- 2026-09-02-03-add-direct-conversation-member-status.sql
-- Message requests (Instagram-style) for 1:1 chat: a new conversation's
-- recipient starts 'pending' (can read, can't reply until they accept) —
-- scoped to direct_conversation_members only, spaces already have their own
-- separate space_join_requests system, untouched by this.
--
-- Default 'accepted' matters: every EXISTING member row predates this
-- feature and was never "pending" anything — only newly created recipient
-- rows (ChatsService.createConversation) start pending going forward.

DO $$
BEGIN
  CREATE TYPE havit.direct_conversation_member_status_enum AS ENUM (
    'accepted', 'pending'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE havit.direct_conversation_members
  ADD COLUMN IF NOT EXISTS status
    havit.direct_conversation_member_status_enum NOT NULL DEFAULT 'accepted';
