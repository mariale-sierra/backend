import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { NotificationType } from './notification-type.entity';
import type { NotificationEntityType } from '../notification-catalog';

@Entity({ schema: 'havit', name: 'notifications' })
export class Notification {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'uuid' })
  recipient_user_id!: string;

  /** NULL once the actor's account is purged (B2) or for system events. */
  @Column({ type: 'uuid', nullable: true })
  actor_user_id?: string | null;

  @Column({ type: 'bigint' })
  notification_type_id!: string;

  /** The resource the notification navigates to (not the event itself). */
  @Column({
    type: 'enum',
    enum: [
      'workout_post',
      'direct_message',
      'space',
      'user_follow',
      'challenge',
      'direct_conversation',
      'challenge_invite',
      'content_report',
      'user',
    ],
    enumName: 'notification_related_entity_type_enum',
  })
  related_entity_type!: NotificationEntityType;

  @Column({ type: 'varchar', length: 64, nullable: true })
  related_entity_id?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title?: string | null;

  @Column({ type: 'text', nullable: true })
  body?: string | null;

  /** Extra ids the app needs to navigate — never user-written content. */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  data!: Record<string, string>;

  @Column({ default: false })
  is_read!: boolean;

  /** Set by the app with millisecond precision (see NotificationsService.notify) so keyset cursors never skip rows. */
  @Column({ type: 'timestamp' })
  created_at!: Date;

  @Column({ default: true })
  is_active!: boolean;

  @ManyToOne(() => NotificationType)
  @JoinColumn({ name: 'notification_type_id' })
  type?: NotificationType;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'actor_user_id' })
  actor?: User | null;
}
