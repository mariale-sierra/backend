import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
} from 'typeorm';
import { RoutineExercise } from '../../routine/entities/routine-exercise.entity';
import { WorkoutLogExercise } from '../../workout-log/entities/workout-log-exercise.entity';

export enum TrackingMode {
  SINGLE = 'single',
  SETS = 'sets',
  INTERVAL = 'interval',
  MIXED = 'mixed',
}

@Entity({ schema: 'havit', name: 'exercises' })
export class Exercise {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column({ unique: true })
  slug!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'text' })
  instructions!: string;

  @Column({ nullable: true })
  icon_url?: string;

  @Column({ type: 'enum', enum: TrackingMode })
  tracking_mode!: TrackingMode;

  @Column({ default: true })
  is_active!: boolean;

  @OneToMany(() => RoutineExercise, (re) => re.exercise)
  routine_exercises?: RoutineExercise[];

  @OneToMany(() => WorkoutLogExercise, (wle) => wle.exercise)
  workout_log_exercises?: WorkoutLogExercise[];
}