-- 2026-09-01-01-add-direct-messages-read-status.sql
-- Chats module (1:1 direct messaging): adds read/unread tracking to the
-- pre-existing havit.direct_messages table (created in init, unused by any
-- backend module until now). A message is unread while read_at is NULL;
-- it is set once the recipient (the conversation participant who is not
-- the sender) opens the conversation. Nullable and additive only — no
-- backfill needed, existing rows (if any) are simply "unread" by default,
-- which is correct since nothing has ever marked them read.

ALTER TABLE havit.direct_messages
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_direct_messages_conversation_sent
  ON havit.direct_messages (direct_conversation_id, sent_at);

-- Speeds up "unread count per conversation for the other participant"
-- (direct_conversation_id + user_id filter, read_at IS NULL), the query the
-- conversation list runs once per conversation.
CREATE INDEX IF NOT EXISTS idx_direct_messages_unread
  ON havit.direct_messages (direct_conversation_id, user_id)
  WHERE read_at IS NULL;

-- direct_conversation_members' PK is (direct_conversation_id, user_id), which
-- doesn't help "find all conversations for user X" (user_id isn't the
-- leading column). Needed for listing a user's conversations.
CREATE INDEX IF NOT EXISTS idx_direct_conversation_members_user
  ON havit.direct_conversation_members (user_id);
