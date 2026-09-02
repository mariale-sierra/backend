-- 2026-09-02-02-add-space-messages.sql
-- Space group messaging (Sprint 8, Bloque 2 — wireframe Chats-47B): a space's
-- own group chat thread, distinct from havit.direct_messages (1:1 DMs,
-- ChatsModule). Mirrors direct_messages' shape/conventions exactly — same
-- column set, same soft-delete via is_active, same identity PK — just keyed
-- to a space instead of a direct_conversation, and with no per-recipient
-- read-tracking (a group thread has no single "the other participant").

CREATE TABLE IF NOT EXISTS havit.space_messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  space_id UUID NOT NULL,
  user_id UUID NOT NULL,
  message_text TEXT NOT NULL,
  sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_space_messages_space
    FOREIGN KEY (space_id) REFERENCES havit.spaces (id) ON DELETE CASCADE,
  CONSTRAINT fk_space_messages_user
    FOREIGN KEY (user_id) REFERENCES havit.users (id) ON DELETE CASCADE
);
COMMENT ON TABLE havit.space_messages IS 'Mensajes del chat grupal de un space (Chats-47B).';

-- Backs the keyset-pagination query (space_id = X ORDER BY id DESC LIMIT N),
-- same shape as direct_messages' own idx_direct_messages_conversation_id.
CREATE INDEX IF NOT EXISTS idx_space_messages_space_id_id
  ON havit.space_messages (space_id, id DESC);
