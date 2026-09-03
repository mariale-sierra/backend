import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { DirectConversation } from './direct-conversation.entity';
import { User } from '../../users/entities/user.entity';

export type DirectConversationMemberStatus = 'accepted' | 'pending';

/**
 * Maps to havit.direct_conversation_members. This service only ever inserts
 * exactly two members per conversation (1:1) — that invariant is what lets
 * ChatsService.findExistingConversation() find "the" conversation between a
 * pair of users with a plain self-join, no dedup column needed.
 *
 * `status` (2026-09-02-03-add-direct-conversation-member-status.sql) backs
 * message requests: a conversation's recipient row starts 'pending' — they
 * can read but not reply until they accept. Every pre-existing row defaults
 * to 'accepted' (this feature didn't exist when they were created).
 */
@Entity({ schema: 'havit', name: 'direct_conversation_members' })
export class DirectConversationMember {
  @PrimaryColumn({ type: 'uuid' })
  direct_conversation_id!: string;

  @PrimaryColumn({ type: 'uuid' })
  user_id!: string;

  @CreateDateColumn()
  joined_at!: Date;

  @Column({
    type: 'enum',
    enum: ['accepted', 'pending'],
    enumName: 'direct_conversation_member_status_enum',
    default: 'accepted',
  })
  status!: DirectConversationMemberStatus;

  @ManyToOne(() => DirectConversation)
  @JoinColumn({ name: 'direct_conversation_id' })
  conversation?: DirectConversation;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;
}
