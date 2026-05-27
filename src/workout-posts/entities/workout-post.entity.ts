import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { WorkoutLog } from '../../workout-log/entities/workout-log.entity';

@Entity({ schema: 'havit', name: 'workout_posts' })
export class WorkoutPost {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  workout_log_id!: number;

  @Column()
  user_id!: string;

  @Column()
  image_url!: string;

  @Column({ nullable: true })
  caption?: string;

  @Column()
  visibility!: 'private' | 'followers';

  @CreateDateColumn()
  created_at!: Date;

  @ManyToOne(() => WorkoutLog, (workoutLog) => workoutLog.posts)
  @JoinColumn({ name: 'workout_log_id' })
  workoutLog!: WorkoutLog;
}
