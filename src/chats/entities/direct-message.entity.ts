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
 * `workout_post_id` already exists in the schema (sharing a workout post
 * into a DM) but nothing in this module reads or writes it yet — left as an
 * untouched nullable column, not part of this feature's scope.
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
