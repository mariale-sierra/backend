import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { WorkoutPost } from './workout-post.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Maps to havit.workout_post_comments
 * (2026-09-08-01-create-workout-post-comments.sql). Flat comments (no
 * replies) — soft delete via is_active, same convention as SpaceMessage /
 * UserFollow / WorkoutPost itself.
 */
@Entity({ schema: 'havit', name: 'workout_post_comments' })
export class WorkoutPostComment {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'uuid' })
  workout_post_id!: string;

  @Column({ type: 'uuid' })
  user_id!: string;

  @Column()
  comment_text!: string;

  @CreateDateColumn()
  created_at!: Date;

  @Column({ default: true })
  is_active!: boolean;

  @ManyToOne(() => WorkoutPost)
  @JoinColumn({ name: 'workout_post_id' })
  post?: WorkoutPost;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  author?: User;
}
