 import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { WorkoutLog } from './workout-log.entity';
import { Exercise } from '../../exercises/entities/exercise.entity';
import { WorkoutLogExerciseMetric } from '../../workout-log/entities/workout-log-exercise-metric.entity';

@Entity({ schema: 'havit', name: 'workout_log_exercises' })
export class WorkoutLogExercise {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => WorkoutLog, (log) => log.exercises, {
    onDelete: 'CASCADE',
  })
  workout_log!: WorkoutLog;

  @Column()
  workout_log_id!: number;

  @ManyToOne(() => Exercise, (e) => e.workout_log_exercises)
  exercise!: Exercise;

  @Column()
  exercise_id!: number;

  @OneToMany(
    () => WorkoutLogExerciseMetric,
    (metric) => metric.workout_log_exercise,
  )
  metrics?: WorkoutLogExerciseMetric[];
}