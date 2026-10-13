import { CreateDateColumn, Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Maps to havit.workout_post_tagged_users (2026-10-12-01): participants the
 * challenge owner tagged in a joint progress post. Composite PK — a user is
 * tagged at most once per post — and no status: tagging needs no
 * confirmation from the tagged user (product decision).
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
}
