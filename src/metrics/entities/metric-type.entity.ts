import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
} from 'typeorm';

export enum MetricValueType {
  INT = 'int',
  DECIMAL = 'decimal',
  SECONDS = 'seconds',
  TEXT = 'text',
  BOOLEAN = 'boolean',
}

@Entity({ schema: 'havit', name: 'metric_types' })
export class MetricType {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ length: 100, unique: true })
  code!: string;

  @Column({ length: 150 })
  name!: string;

  @Column({
    name: 'value_type',
    type: 'enum',
    enum: MetricValueType,
  })
  valueType!: MetricValueType;

  @Column({ name: 'default_unit', length: 50, nullable: true })
  defaultUnit?: string;

  @Column({ type: 'text', nullable: true })
  description?: string;
}