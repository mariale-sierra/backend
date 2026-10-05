import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type PushPlatform = 'ios' | 'android';

/** One Expo push token per device, unique across users (uq_device_push_tokens_token). */
@Entity({ schema: 'havit', name: 'device_push_tokens' })
export class DevicePushToken {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'uuid' })
  user_id!: string;

  @Column({ length: 255 })
  token!: string;

  @Column({ length: 16 })
  platform!: PushPlatform;

  @Column({ default: true })
  is_active!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @Column({ type: 'timestamptz' })
  last_seen_at!: Date;
}
