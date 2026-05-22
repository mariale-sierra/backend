import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

import { RoutineExercise } from './routine-exercise.entity';
import { MetricType } from '../../metrics/entities/metric-type.entity';

@Entity({
  schema: 'havit',
  name: 'routine_exercise_targets',
})
export class RoutineExerciseTarget {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  routine_exercise_id!: string;

  @Column('int')
  metric_type_id!: number;

  @Column({ type: 'int', nullable: true })
  target_value_int?: number;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 4,
    nullable: true,
  })
  target_value_decimal?: number;

  @Column({ type: 'text', nullable: true })
  target_value_text?: string;

  @Column({ type: 'int', nullable: true })
  target_value_seconds?: number;

  @Column({ type: 'boolean', nullable: true })
  target_value_boolean?: boolean;

  @Column({
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  unit?: string;

  @ManyToOne(
    () => RoutineExercise,
    routineExercise => routineExercise.targets,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'routine_exercise_id' })
  routineExercise!: RoutineExercise;

  @ManyToOne(() => MetricType)
  @JoinColumn({ name: 'metric_type_id' })
  metricType!: MetricType;
}