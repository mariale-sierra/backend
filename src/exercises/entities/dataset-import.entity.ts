import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ schema: 'havit', name: 'dataset_imports' })
export class DatasetImport {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  source!: string;

  @Column({ name: 'source_version' })
  sourceVersion!: string;

  @Column({ name: 'dataset_checksum' })
  datasetChecksum!: string;

  @Column({ name: 'started_at' })
  startedAt!: Date;

  @Column({ name: 'finished_at', type: 'timestamp', nullable: true })
  finishedAt?: Date | null;

  @Column({ name: 'exercises_created', default: 0 })
  exercisesCreated!: number;

  @Column({ name: 'exercises_updated', default: 0 })
  exercisesUpdated!: number;

  @Column({ name: 'exercises_skipped', default: 0 })
  exercisesSkipped!: number;

  @Column({ name: 'assets_uploaded', default: 0 })
  assetsUploaded!: number;

  @Column({ name: 'assets_skipped_unchanged', default: 0 })
  assetsSkippedUnchanged!: number;

  @Column({ default: 'running' })
  status!: string;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;
}
