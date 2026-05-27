import { Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Column } from 'typeorm';
import { Exercise } from './exercise.entity';
import { ExerciseLocation } from './exercise-location.entity';

@Index('uq_exercise_location_primary', ['exerciseId'], {
  unique: true,
  where: '"is_primary" = true',
})
@Entity({ schema: 'havit', name: 'exercise_location_map' })
export class ExerciseLocationMap {
  @PrimaryColumn({ name: 'exercise_id' })
  exerciseId!: number;

  @PrimaryColumn({ name: 'location_id' })
  locationId!: number;

  @Column({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary!: boolean;

  @ManyToOne(() => Exercise, (exercise) => exercise.location_maps, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'exercise_id' })
  exercise!: Exercise;

  @ManyToOne(() => ExerciseLocation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'location_id' })
  location!: ExerciseLocation;
}
