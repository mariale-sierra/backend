import {
  Entity,
  ManyToOne,
  JoinColumn,
  Column,
  PrimaryColumn,
} from 'typeorm';
import { Exercise } from './exercise.entity';
import { MetricType } from '../../metrics/entities/metric-type.entity';

@Entity({ schema: 'havit', name: 'exercise_metrics' })
export class ExerciseMetric {
  @PrimaryColumn({ name: 'exercise_id' })
  exerciseId!: number;

  @PrimaryColumn({ name: 'metric_type_id' })
  metricTypeId!: number;

  @ManyToOne(() => Exercise, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'exercise_id' })
  exercise!: Exercise;

  @ManyToOne(() => MetricType, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'metric_type_id' })
  metricType!: MetricType;

  @Column({ name: 'is_required', default: false })
  isRequired!: boolean;

  @Column({ name: 'is_primary', default: false })
  isPrimary!: boolean;

  @Column({ name: 'default_unit', length: 50, nullable: true })
  defaultUnit?: string;
}