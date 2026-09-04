import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { RoutineExercise } from '../../routine/entities/routine-exercise.entity';
import { ExerciseMetric } from './exercise-metric.entity';
import { ExerciseCategoryMap } from './exercise-category-map.entity';
import { ExerciseLocationMap } from './exercise-location-map.entity';
import { ExerciseBodyPartMap } from './exercise-body-part-map.entity';
import { ExerciseMuscle } from './exercise-muscle.entity';
import { ExerciseTranslation } from './exercise-translation.entity';
import { ExerciseAsset } from './exercise-asset.entity';

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
  icon_url?: string;

  @Column({ type: 'enum', enum: TrackingMode })
  tracking_mode!: TrackingMode;

  @Column({ default: true })
  is_active!: boolean;

  @Column({ name: 'region_id', type: 'int', nullable: true })
  regionId?: number | null;

  @Column({ default: 'manual' })
  source!: string;

  @Column({ name: 'source_id', type: 'varchar', nullable: true })
  sourceId?: string | null;

  @Column({ name: 'source_import_id', type: 'int', nullable: true })
  sourceImportId?: number | null;

  @Column({ name: 'content_locked', default: false })
  contentLocked!: boolean;

  @Column({ name: 'exercise_source_metadata', type: 'jsonb', nullable: true })
  exerciseSourceMetadata?: Record<string, unknown> | null;

  @OneToMany(() => RoutineExercise, (re) => re.exercise)
  routine_exercises?: RoutineExercise[];

  @OneToMany(() => ExerciseMetric, (em) => em.exercise)
  exercise_metrics?: ExerciseMetric[];

  @OneToMany(() => ExerciseCategoryMap, (map) => map.exercise)
  category_maps?: ExerciseCategoryMap[];

  @OneToMany(() => ExerciseLocationMap, (map) => map.exercise)
  location_maps?: ExerciseLocationMap[];

  @OneToMany(() => ExerciseBodyPartMap, (map) => map.exercise)
  body_part_maps?: ExerciseBodyPartMap[];

  @OneToMany(() => ExerciseMuscle, (map) => map.exercise)
  muscle_maps?: ExerciseMuscle[];

  @OneToMany(() => ExerciseTranslation, (t) => t.exercise)
  translations?: ExerciseTranslation[];

  @OneToMany(() => ExerciseAsset, (a) => a.exercise)
  assets?: ExerciseAsset[];
}
