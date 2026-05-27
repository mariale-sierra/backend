import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { WorkoutLogExercise } from './workout-log-exercise.entity';
import { MetricType } from '../../metrics/entities/metric-type.entity';

@Entity({ schema: 'havit', name: 'workout_log_exercise_targets' })
export class WorkoutLogExerciseTarget {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'workout_log_exercise_id' })
  workoutLogExerciseId!: number;

  @Column({ name: 'metric_type_id' })
  metricTypeId!: number;

  @Column({ name: 'target_value_int', type: 'int', nullable: true })
  targetValueInt?: number;

  @Column({
    name: 'target_value_decimal',
    type: 'numeric',
    precision: 12,
    scale: 4,
    nullable: true,
  })
  targetValueDecimal?: number;

  @Column({ name: 'target_value_text', type: 'text', nullable: true })
  targetValueText?: string;

  @Column({ name: 'target_value_seconds', type: 'int', nullable: true })
  targetValueSeconds?: number;

  @Column({ name: 'target_value_boolean', type: 'boolean', nullable: true })
  targetValueBoolean?: boolean;

  @Column({ name: 'unit', type: 'varchar', length: 50, nullable: true })
  unit?: string;

  @ManyToOne(() => WorkoutLogExercise, (exercise) => exercise.targets, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'workout_log_exercise_id' })
  workoutLogExercise!: WorkoutLogExercise;

  @ManyToOne(() => MetricType)
  @JoinColumn({ name: 'metric_type_id' })
  metricType!: MetricType;
}