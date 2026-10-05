import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Opt-out per user and notification type. No row = everything enabled. */
@Entity({ schema: 'havit', name: 'notification_preferences' })
export class NotificationPreference {
  @PrimaryColumn({ type: 'uuid' })
  user_id!: string;

  @PrimaryColumn({ type: 'bigint' })
  notification_type_id!: string;

  @Column({ default: true })
  in_app_enabled!: boolean;

  @Column({ default: true })
  push_enabled!: boolean;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}
