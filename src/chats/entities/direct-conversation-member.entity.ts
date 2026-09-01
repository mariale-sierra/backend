import {
  Entity,
  PrimaryColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { DirectConversation } from './direct-conversation.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Maps to havit.direct_conversation_members. This service only ever inserts
 * exactly two members per conversation (1:1) — that invariant is what lets
 * ChatsService.findExistingConversation() find "the" conversation between a
 * pair of users with a plain self-join, no dedup column needed.
 */
@Entity({ schema: 'havit', name: 'direct_conversation_members' })
export class DirectConversationMember {
  @PrimaryColumn({ type: 'uuid' })
  direct_conversation_id!: string;

  @PrimaryColumn({ type: 'uuid' })
  user_id!: string;

  @CreateDateColumn()
  joined_at!: Date;

  @ManyToOne(() => DirectConversation)
  @JoinColumn({ name: 'direct_conversation_id' })
  conversation?: DirectConversation;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;
}
