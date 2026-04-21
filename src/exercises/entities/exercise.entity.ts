import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
} from 'typeorm';
import { ExerciseCategoryMap } from './exercise-category-map.entity';
import { ExerciseLocationMap } from './exercise-location-map.entity';
import { ExerciseBodyPartMap } from './exercise-body-part-map.entity';
import { ExerciseMetric } from './exercise-metric.entity';
import { RoutineExercise } from './routine-exercise.entity';
import { WorkoutLogExercise } from './workout-log-exercise.entity';

export enum TrackingMode {
  SINGLE = 'single',
  SETS = 'sets',
  INTERVAL = 'interval',
  MIXED = 'mixed',
}

@Entity({ schema: 'havit', name: 'exercises' })
export class Exercise {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column({ unique: true })
  slug!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'text' })
  instructions!: string;

  @Column({ nullable: true })