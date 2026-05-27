import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Exercise } from './exercise.entity';
import { ExerciseLocation } from './exercise-location.entity';

@Entity({ schema: 'havit', name: 'exercise_location_map' })
export class ExerciseLocationMap {
  @PrimaryColumn({ name: 'exercise_id' })
  exerciseId!: number;

  @PrimaryColumn({ name: 'location_id' })
  locationId!: number;

  @ManyToOne(() => Exercise, (exercise) => exercise.location_maps, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'exercise_id' })
  exercise!: Exercise;

  @ManyToOne(() => ExerciseLocation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'location_id' })
  location!: ExerciseLocation;
}
