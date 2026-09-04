import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Exercise } from './exercise.entity';

export type ExerciseAssetType =
  | 'start'
  | 'peak'
  | 'main'
  | 'thumbnail'
  | 'animation';

@Entity({ schema: 'havit', name: 'exercise_assets' })
export class ExerciseAsset {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'exercise_id' })
  exerciseId!: number;

  @Column({
    type: 'enum',
    enum: ['start', 'peak', 'main', 'thumbnail', 'animation'],
  })
  type!: ExerciseAssetType;

  @Column({ name: 'storage_key', unique: true })
  storageKey!: string;

  @Column({ name: 'content_hash', type: 'varchar', nullable: true })
  contentHash?: string | null;

  @Column({ type: 'int', nullable: true })
  width?: number | null;

  @Column({ type: 'int', nullable: true })
  height?: number | null;

  @Column({ name: 'byte_size', type: 'int', nullable: true })
  byteSize?: number | null;

  @Column({ default: 'repdb' })
  source!: string;

  @Column({ name: 'imported_at' })
  importedAt!: Date;

  @ManyToOne(() => Exercise, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'exercise_id' })
  exercise!: Exercise;
}
