import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { WorkoutLogExercise } from '../../workout-log/entities/workout-log-exercise.entity';

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
}