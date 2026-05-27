 import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { WorkoutLog } from './workout-log.entity';
import { Exercise } from '../../exercises/entities/exercise.entity';
import { WorkoutLogExerciseMetric } from '../../metrics/entities/workout-log-exercise-metric.entity';
import { WorkoutLogExerciseTarget } from './workout-log-exercise-target.entity';
import { WorkoutLogExerciseSet } from './workout-log-exercise-set.entity';

@Entity({ schema: 'havit', name: 'workout_log_exercises' })
export class WorkoutLogExercise {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => WorkoutLog, (w) => w.exercises)
  @JoinColumn({ name: 'workout_log_id' })
  workout!: WorkoutLog;

  @ManyToOne(() => Exercise)
  @JoinColumn({ name: 'exercise_id' })
  exercise!: Exercise;

  @OneToMany(
  () => WorkoutLogExerciseMetric,
  (metric) => metric.workoutLogExercise,
  )
  metrics?: WorkoutLogExerciseMetric[];

  @OneToMany(
    () => WorkoutLogExerciseTarget,
    (target) => target.workoutLogExercise,
  )
  targets?: WorkoutLogExerciseTarget[];

  @OneToMany(() => WorkoutLogExerciseSet, (set) => set.workoutLogExercise)
  sets?: WorkoutLogExerciseSet[];

  @Column({ name: 'order_index', nullable: true })
  orderIndex?: number;

  @Column({ nullable: true })
  notes?: string;
}