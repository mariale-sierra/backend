import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { WorkoutLog } from '../../workout-log/entities/workout-log.entity';

export enum WorkoutPostModerationStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity({ schema: 'havit', name: 'workout_posts' })
export class WorkoutPost {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  workout_log_id!: number;

  @Column()
  user_id!: string;

  @Column()
  image_url!: string;

  @Column({ nullable: true })
  caption?: string;

  @Column()
  visibility!: 'private' | 'followers' | 'public';

  @Column({
    name: 'moderation_status',
    type: 'enum',
    enum: WorkoutPostModerationStatus,
    default: WorkoutPostModerationStatus.PENDING,
  })
  moderationStatus!: WorkoutPostModerationStatus;

  @Column({ name: 'moderation_reason', type: 'text', nullable: true })
  moderationReason?: string;

  @Column({ name: 'moderated_at', type: 'timestamp', nullable: true })
  moderatedAt?: Date;

  /** Oculto por un admin al resolver un reporte (Sprint 8, B2). */
  @Column({ default: false })
  is_hidden!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  hidden_at?: Date | null;

  @Column({ type: 'text', nullable: true })
  hidden_reason?: string | null;

  @CreateDateColumn()
  created_at!: Date;

  @ManyToOne(() => WorkoutLog, (workoutLog) => workoutLog.posts)
  @JoinColumn({ name: 'workout_log_id' })
  workoutLog!: WorkoutLog;
}
