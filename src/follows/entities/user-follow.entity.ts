import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity({ schema: 'havit', name: 'user_follows' })
export class UserFollow {
  @PrimaryColumn({ type: 'uuid' })
  follower_user_id!: string;

  @PrimaryColumn({ type: 'uuid' })
  followed_user_id!: string;

  @CreateDateColumn()
  created_at!: Date;

  @Column({ default: true })
  is_active!: boolean;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'follower_user_id' })
  follower?: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'followed_user_id' })
  followed?: User;
}
