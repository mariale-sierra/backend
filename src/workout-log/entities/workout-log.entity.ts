import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { WorkoutLogExercise } from '../../workout-log/entities/workout-log-exercise.entity';
import { WorkoutPost } from '../../workout-posts/entities/workout-post.entity';

export enum WorkoutStatus {
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

@Entity({ schema: 'havit', name: 'workout_logs' })
export class WorkoutLog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'routine_id', nullable: true })
  routineId?: number;

  @Column({ name: 'challenge_id', type: 'uuid', nullable: true })
  challengeId?: string;

  @Column({ name: 'challenge_cycle_day_id', nullable: true })
  challengeCycleDayId?: number;

  /**
   * The caller's local calendar day (YYYY-MM-DD) at submission time, per the
   * `X-Timezone` header -- only set when challengeId is set. Backs
   * uq_workout_logs_user_challenge_local_day (see
   * database/migrations/2026-09-28-01-workout-logs-progress-uniqueness.sql),
   * the DB-level "one progress record per day per challenge" guarantee.
   */
  @Column({ name: 'local_day', type: 'date', nullable: true })
  localDay?: string;

  @Column({ name: 'started_at', type: 'timestamp' })
  started_at!: Date;

  @Column({ name: 'ended_at', type: 'timestamp', nullable: true })
  ended_at?: Date;

  @Column({ name: 'status', type: 'enum', enum: WorkoutStatus })
  status!: WorkoutStatus;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes?: string;

  @OneToMany(() => WorkoutLogExercise, (wle) => wle.workout)
  exercises?: WorkoutLogExercise[];

  @OneToMany(() => WorkoutPost, (post) => post.workoutLog)
  posts?: WorkoutPost[];
}
