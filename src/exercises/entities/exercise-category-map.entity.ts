import { Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Column } from 'typeorm';
import { Exercise } from './exercise.entity';
import { ExerciseCategory } from './exercise-category.entity';

@Index('uq_exercise_category_primary', ['exerciseId'], {
  unique: true,
  where: '"is_primary" = true',
})
@Entity({ schema: 'havit', name: 'exercise_category_map' })
export class ExerciseCategoryMap {
  @PrimaryColumn({ name: 'exercise_id' })
  exerciseId!: number;

  @PrimaryColumn({ name: 'category_id' })
  categoryId!: number;

  @Column({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary!: boolean;

  @ManyToOne(() => Exercise, (exercise) => exercise.category_maps, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'exercise_id' })
  exercise!: Exercise;

  @ManyToOne(() => ExerciseCategory, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'category_id' })
  category!: ExerciseCategory;
}
