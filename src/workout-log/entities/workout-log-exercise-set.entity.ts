import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { WorkoutLogExercise } from './workout-log-exercise.entity';
import { WorkoutLogExerciseSetTarget } from './workout-log-exercise-set-target.entity';

@Entity({ schema: 'havit', name: 'workout_log_exercise_sets' })
export class WorkoutLogExerciseSet {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'workout_log_exercise_id' })
  workoutLogExerciseId!: number;

  @Column({ name: 'set_number', type: 'int' })
  setNumber!: number;

  @Column({ name: 'rest_seconds_after', type: 'int', nullable: true })
  restSecondsAfter?: number;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @ManyToOne(() => WorkoutLogExercise, (exercise) => exercise.sets, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'workout_log_exercise_id' })
  workoutLogExercise!: WorkoutLogExercise;

  @OneToMany(
    () => WorkoutLogExerciseSetTarget,
    (target) => target.workoutLogExerciseSet,
  )
  targets?: WorkoutLogExerciseSetTarget[];
}