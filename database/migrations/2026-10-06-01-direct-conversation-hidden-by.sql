-- 2026-10-06-01-direct-conversation-hidden-by.sql
-- Sprint 9, B4: per-user "delete conversation" for 1:1 chats.
--
-- direct_conversations.is_active is GLOBAL (declineRequest() turns the
-- conversation off for BOTH participants) and can't express "user A removed
-- this chat from their own list while user B keeps it". One row here means
-- `user_id` hid `direct_conversation_id` from their own conversation list.
-- Messages and the conversation itself are never touched; a new message
-- successfully sent in the conversation clears its rows
-- (ChatsService.sendMessage), so new activity brings it back.

CREATE TABLE IF NOT EXISTS havit.direct_conversation_hidden_by (
  direct_conversation_id UUID NOT NULL,
  user_id UUID NOT NULL,
  hidden_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (direct_conversation_id, user_id),
  CONSTRAINT fk_direct_conversation_hidden_by_conversation
    FOREIGN KEY (direct_conversation_id)
    REFERENCES havit.direct_conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_direct_conversation_hidden_by_user
    FOREIGN KEY (user_id) REFERENCES havit.users(id) ON DELETE CASCADE
);

-- listConversations() looks up every conversation a user hid.
CREATE INDEX IF NOT EXISTS idx_direct_conversation_hidden_by_user
  ON havit.direct_conversation_hidden_by (user_id);
