import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { Routine } from './routine.entity';
import { WorkoutLogExercise } from './workout-log-exercise.entity';

@Entity({ schema: 'havit', name: 'workout_logs' })
export class WorkoutLog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  user_id!: number;

  @ManyToOne(() => Routine, (r) => r.workout_logs, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  routine?: Routine;

  @Column({ nullable: true })
  routine_id?: number;

  @Column({ type: 'timestamp', nullable: true })
  started_at?: Date;

  @Column({ type: 'timestamp', nullable: true })
  ended_at?: Date;

  @Column({ default: false })
  is_completed!: boolean;

  @OneToMany(() => WorkoutLogExercise, (wle) => wle.workout_log)
  exercises?: WorkoutLogExercise[];
}