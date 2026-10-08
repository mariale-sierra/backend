import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { DirectConversation } from './direct-conversation.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Maps to havit.direct_messages. `read_at` (nullable) was added by
 * 2026-09-01-01-add-direct-messages-read-status.sql on top of the
 * pre-existing init-schema table — a message is unread while it's NULL.
 *
 * Shared content (Sprint 10, B5): a message may carry ONE optional
 * reference next to its text — `workout_post_id` (pre-existing init-schema
 * column) or `challenge_id` (2026-10-07-01-add-direct-messages-challenge-id.sql).
 * Both are ON DELETE SET NULL, so the message survives its content.
 */
@Entity({ schema: 'havit', name: 'direct_messages' })
export class DirectMessage {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'uuid' })
  direct_conversation_id!: string;

  @Column({ type: 'uuid' })
  user_id!: string;

  @Column({ type: 'uuid', nullable: true })
  workout_post_id?: string | null;

  @Column({ type: 'uuid', nullable: true })
  challenge_id?: string | null;

  @Column()
  message_text!: string;

  @CreateDateColumn()
  sent_at!: Date;

  @Column({ default: true })
  is_active!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  read_at?: Date | null;

  @ManyToOne(() => DirectConversation)
  @JoinColumn({ name: 'direct_conversation_id' })
  conversation?: DirectConversation;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  sender?: User;
}
