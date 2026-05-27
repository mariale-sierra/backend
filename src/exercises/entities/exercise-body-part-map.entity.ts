import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Exercise } from './exercise.entity';
import { ExerciseBodyPart } from './exercise-body-part.entity';

@Entity({ schema: 'havit', name: 'exercise_body_part_map' })
export class ExerciseBodyPartMap {
  @PrimaryColumn({ name: 'exercise_id' })
  exerciseId!: number;

  @PrimaryColumn({ name: 'body_part_id' })
  bodyPartId!: number;

  @ManyToOne(() => Exercise, (exercise) => exercise.body_part_maps, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'exercise_id' })
  exercise!: Exercise;

  @ManyToOne(() => ExerciseBodyPart, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'body_part_id' })
  bodyPart!: ExerciseBodyPart;
}
