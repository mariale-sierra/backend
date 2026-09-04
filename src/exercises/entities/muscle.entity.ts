import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { MuscleRegion } from './muscle-region.entity';

@Entity({ schema: 'havit', name: 'muscles' })
export class Muscle {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'region_id' })
  regionId!: number;

  @Column({ unique: true })
  code!: string;

  @Column()
  name!: string;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder!: number;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @Column({ name: 'icon_storage_key', type: 'varchar', nullable: true })
  iconStorageKey?: string | null;

  @Column({ name: 'icon_content_hash', type: 'varchar', nullable: true })
  iconContentHash?: string | null;

  @ManyToOne(() => MuscleRegion, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'region_id' })
  region!: MuscleRegion;
}
