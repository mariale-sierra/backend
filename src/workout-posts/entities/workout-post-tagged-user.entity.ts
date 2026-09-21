import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { WorkoutPost } from './workout-post.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Maps to havit.workout_post_tagged_users (added in
 * 2026-09-20-01-add-challenge-roles.sql). Composite PK (workout_post_id,
 * user_id) — same shape as WorkoutPostLike — enforces "tagged at most once
 * per user per post". Deliberately no status column: tagging a joint post is
 * a decision the challenge owner makes, not a request the tagged user has to
 * accept (product decision).
 */
@Entity({ schema: 'havit', name: 'workout_post_tagged_users' })
export class WorkoutPostTaggedUser {
  @PrimaryColumn({ type: 'uuid' })
  workout_post_id!: string;

  @PrimaryColumn({ type: 'uuid' })
  user_id!: string;

  @Column({ type: 'uuid' })
  tagged_by_user_id!: string;

  @CreateDateColumn()
  created_at!: Date;

  @ManyToOne(() => WorkoutPost)
  @JoinColumn({ name: 'workout_post_id' })
  post?: WorkoutPost;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;
}
