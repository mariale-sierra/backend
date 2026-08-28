import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Challenge } from './challenge.entity';
import { ExerciseCategory } from '../../exercises/entities/exercise-category.entity';

@Entity({ schema: 'havit', name: 'challenge_category_map' })
export class ChallengeCategoryMap {
  @PrimaryColumn({ name: 'challenge_id', type: 'uuid' })
  challengeId!: string;

  @PrimaryColumn({ name: 'category_id' })
  categoryId!: number;

  // Position (0-based) the user picked this category in at challenge
  // creation — see 2026-08-28-01-add-challenge-category-map-order-index.sql.
  // Pre-existing rows default to 0 (no meaningful order to backfill).
  @Column({ name: 'order_index', type: 'smallint', default: 0 })
  orderIndex!: number;

  @ManyToOne(() => Challenge, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'challenge_id' })
  challenge!: Challenge;

  @ManyToOne(() => ExerciseCategory, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'category_id' })
  category!: ExerciseCategory;
}
