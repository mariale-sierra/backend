import {
  Entity,
  PrimaryColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { WorkoutPost } from './workout-post.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Maps to havit.workout_post_likes, already present in the init schema
 * (database/init/2026-07-07-00-init-schema.sql) but never wired to any
 * entity/service before this. Composite PK (workout_post_id, user_id)
 * enforces "one reaction per user per post" at the DB level — same pattern
 * as UserFollow. Only one reaction type exists ('like'), so there's no
 * separate type column.
 */
@Entity({ schema: 'havit', name: 'workout_post_likes' })
export class WorkoutPostLike {
  @PrimaryColumn({ type: 'uuid' })
  workout_post_id!: string;

  @PrimaryColumn({ type: 'uuid' })
  user_id!: string;

  @CreateDateColumn()
  created_at!: Date;

  @ManyToOne(() => WorkoutPost)
  @JoinColumn({ name: 'workout_post_id' })
  post?: WorkoutPost;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;
}
