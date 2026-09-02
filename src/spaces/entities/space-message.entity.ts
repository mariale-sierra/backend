import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Space } from './space.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Maps to havit.space_messages (2026-09-02-02-add-space-messages.sql) — a
 * space's own group chat thread. Same shape/conventions as
 * DirectMessage (chats module), just keyed to a space instead of a
 * direct_conversation, and with no `read_at` — a group thread has no single
 * "the other participant" to track read status against.
 */
@Entity({ schema: 'havit', name: 'space_messages' })
export class SpaceMessage {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'uuid' })
  space_id!: string;

  @Column({ type: 'uuid' })
  user_id!: string;

  @Column()
  message_text!: string;

  @CreateDateColumn()
  sent_at!: Date;

  @Column({ default: true })
  is_active!: boolean;

  @ManyToOne(() => Space)
  @JoinColumn({ name: 'space_id' })
  space?: Space;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  sender?: User;
}
