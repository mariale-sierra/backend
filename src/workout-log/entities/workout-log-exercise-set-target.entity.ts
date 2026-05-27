import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { WorkoutLogExerciseSet } from './workout-log-exercise-set.entity';
import { MetricType } from '../../metrics/entities/metric-type.entity';

@Entity({ schema: 'havit', name: 'workout_log_exercise_set_targets' })
export class WorkoutLogExerciseSetTarget {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'workout_log_exercise_set_id' })
  workoutLogExerciseSetId!: number;

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

  @ManyToOne(() => WorkoutLogExerciseSet, (set) => set.targets, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'workout_log_exercise_set_id' })
  workoutLogExerciseSet!: WorkoutLogExerciseSet;

  @ManyToOne(() => MetricType)
  @JoinColumn({ name: 'metric_type_id' })
  metricType!: MetricType;
}