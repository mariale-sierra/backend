import { Entity, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Challenge } from './challenge.entity';
import { ExerciseCategory } from '../../exercises/entities/exercise-category.entity';

@Entity({ schema: 'havit', name: 'challenge_category_map' })
export class ChallengeCategoryMap {
  @PrimaryColumn({ name: 'challenge_id', type: 'uuid' })
  challengeId!: string;

  @PrimaryColumn({ name: 'category_id' })
  categoryId!: number;

  @ManyToOne(() => Challenge, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'challenge_id' })
  challenge!: Challenge;

  @ManyToOne(() => ExerciseCategory, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'category_id' })
  category!: ExerciseCategory;
}
