import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export const REPORT_TARGET_TYPES = ['post', 'comment'] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_REASONS = [
  'spam',
  'harassment',
  'hate_speech',
  'nudity',
  'violence',
  'self_harm',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export type ReportStatus = 'pending' | 'dismissed' | 'actioned';

export const REPORT_RESOLUTION_ACTIONS = ['dismiss', 'hide'] as const;
export type ReportResolutionAction = (typeof REPORT_RESOLUTION_ACTIONS)[number];

/**
 * Maps to havit.content_reports (2026-09-27-02-add-reports.sql). A user's
 * report against a workout post or one of its comments — chats/spaces are
 * deliberately out of scope. `target_id` is TEXT because posts use UUIDs and
 * comments use BIGINT ids.
 */
@Entity({ schema: 'havit', name: 'content_reports' })
export class ContentReport {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar' })
  target_type!: ReportTargetType;

  @Column({ type: 'text' })
  target_id!: string;

  @Column({ type: 'uuid' })
  target_owner_id!: string;

  @Column({ type: 'uuid' })
  reporter_id!: string;

  @Column({ type: 'varchar' })
  reason!: ReportReason;

  @Column({ type: 'text', nullable: true })
  details?: string | null;

  @Column({ type: 'varchar', default: 'pending' })
  status!: ReportStatus;

  @Column({ type: 'varchar', nullable: true })
  resolution_action?: ReportResolutionAction | null;

  @Column({ type: 'text', nullable: true })
  resolution_note?: string | null;

  @Column({ type: 'uuid', nullable: true })
  resolved_by?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  resolved_at?: Date | null;

  @CreateDateColumn()
  created_at!: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'reporter_id' })
  reporter?: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'target_owner_id' })
  targetOwner?: User;
}
