import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { WorkoutLogExercise } from '../../workout-log/entities/workout-log-exercise.entity';

@Entity({ schema: 'havit', name: 'workout_log_exercise_metrics' })
export class WorkoutLogExerciseMetric {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(
    () => WorkoutLogExercise,
    (wle) => wle.metrics,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'workout_log_exercise_id' })
  workoutLogExercise!: WorkoutLogExercise;

  @Column({ name: 'metric_type_id' })
  metricTypeId!: number;


  @Column({ name: 'value_int', type: 'int', nullable: true })
  valueInt?: number;

  @Column({ name: 'value_decimal', type: 'numeric', precision: 12, scale: 4, nullable: true })
  valueDecimal?: number;

  @Column({ name: 'value_text', type: 'text', nullable: true })
  valueText?: string;

  @Column({ name: 'value_seconds', type: 'int', nullable: true })
  valueSeconds?: number;

  @Column({ name: 'value_boolean', type: 'boolean', nullable: true })
  valueBoolean?: boolean;

  @Column({ name: 'unit', type: 'varchar', length: 50, nullable: true })
  unit?: string;
}