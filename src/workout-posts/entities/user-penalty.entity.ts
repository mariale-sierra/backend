import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { ReportTargetType } from './content-report.entity';

/**
 * Maps to havit.user_penalties (2026-09-27-02-add-reports.sql). A basic
 * "strike" against the author of content an admin hid after a report.
 * UNIQUE (target_type, target_id) means one piece of content can only ever
 * produce one penalty, however many reports or retried resolutions hit it.
 */
@Entity({ schema: 'havit', name: 'user_penalties' })
export class UserPenalty {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'uuid' })
  user_id!: string;

  @Column({ type: 'bigint' })
  report_id!: number;

  @Column({ type: 'varchar' })
  target_type!: ReportTargetType;

  @Column({ type: 'text' })
  target_id!: string;

  @Column({ type: 'varchar', default: 'strike' })
  penalty_type!: 'strike';

  @Column({ type: 'text', nullable: true })
  reason?: string | null;

  @Column({ type: 'uuid', nullable: true })
  issued_by?: string | null;

  @CreateDateColumn()
  created_at!: Date;
}
