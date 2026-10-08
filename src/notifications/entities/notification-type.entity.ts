import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Catalog row (seeded by database/seeds/2026-10-05-01-notification-types.sql).
 * `code` is the stable contract with the app (NotificationTypeCode);
 * `category` groups types in the Preferences screen.
 */
@Entity({ schema: 'havit', name: 'notification_types' })
export class NotificationType {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ length: 100 })
  code!: string;

  @Column({ length: 150 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ length: 30 })
  category!: string;

  /** false = the in-app notification can't be turned off (moderation acting on your own content). */
  @Column({ default: true })
  user_configurable!: boolean;

  @Column({ default: true })
  is_active!: boolean;
}
