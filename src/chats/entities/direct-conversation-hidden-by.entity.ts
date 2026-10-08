import { Entity, PrimaryColumn, CreateDateColumn } from 'typeorm';

/**
 * Maps to havit.direct_conversation_hidden_by
 * (2026-10-06-01-direct-conversation-hidden-by.sql), Sprint 9 B4: one row
 * means `user_id` removed `direct_conversation_id` from their OWN
 * conversation list. Per-user, unlike DirectConversation.is_active, which is
 * global (declineRequest). Never touches messages; cleared for the whole
 * conversation when a new message is successfully sent in it.
 */
@Entity({ schema: 'havit', name: 'direct_conversation_hidden_by' })
export class DirectConversationHiddenBy {
  @PrimaryColumn({ type: 'uuid' })
  direct_conversation_id!: string;

  @PrimaryColumn({ type: 'uuid' })
  user_id!: string;

  @CreateDateColumn()
  hidden_at!: Date;
}
