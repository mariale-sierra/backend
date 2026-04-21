import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
} from 'typeorm';
import { WorkoutLogExercise } from './workout-log-exercise.entity';
import { ExerciseMetric } from './exercise-metric.entity';

@Entity({ schema: 'havit', name: 'workout_log_exercise_metrics' })
export class WorkoutLogExerciseMetric {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(
    () => WorkoutLogExercise,
    (wle) => wle.metrics,
    { onDelete: 'CASCADE' },
  )
  workout_log_exercise!: WorkoutLogExercise;

  @Column()
  workout_log_exercise_id!: number;

  @ManyToOne(() => ExerciseMetric)
  metric!: ExerciseMetric;

  @Column()
  metric_id!: number;

  @Column('float')
  value!: number;

  @Column({ nullable: true })
  set_number?: number; // 🔥 clave si usas SETS
}