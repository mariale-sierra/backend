import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Muscle } from './muscle.entity';

export type SvgView = 'front' | 'back';
export type SvgSide = 'left' | 'right' | 'center';
export type SvgCoverage = 'exact' | 'grouped' | 'partial' | 'unavailable';

@Entity({ schema: 'havit', name: 'muscle_svg_parts' })
export class MuscleSvgPart {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'muscle_id' })
  muscleId!: number;

  @Column({ type: 'enum', enum: ['front', 'back'] })
  view!: SvgView;

  @Column({
    type: 'enum',
    enum: ['left', 'right', 'center'],
    default: 'center',
  })
  side!: SvgSide;

  @Column({ name: 'svg_part_id' })
  svgPartId!: string;

  @Column({
    type: 'enum',
    enum: ['exact', 'grouped', 'partial', 'unavailable'],
  })
  coverage!: SvgCoverage;

  @Column({ name: 'is_fallback', default: false })
  isFallback!: boolean;

  @Column({ type: 'varchar', nullable: true })
  notes?: string | null;

  @Column({ default: 'muscle_mapper_minimal' })
  source!: string;

  @ManyToOne(() => Muscle, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'muscle_id' })
  muscle!: Muscle;
}
