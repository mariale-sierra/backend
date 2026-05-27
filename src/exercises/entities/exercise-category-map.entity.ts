import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Exercise } from './exercise.entity';
import { ExerciseCategory } from './exercise-category.entity';

@Entity({ schema: 'havit', name: 'exercise_category_map' })
export class ExerciseCategoryMap {
  @PrimaryColumn({ name: 'exercise_id' })
  exerciseId!: number;

  @PrimaryColumn({ name: 'category_id' })
  categoryId!: number;

  @ManyToOne(() => Exercise, (exercise) => exercise.category_maps, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'exercise_id' })
  exercise!: Exercise;

  @ManyToOne(() => ExerciseCategory, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'category_id' })
  category!: ExerciseCategory;
}
