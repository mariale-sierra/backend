import {
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  Column,
  JoinColumn,
} from 'typeorm';
import { Exercise } from '../../exercises/entities/exercise.entity';

@Entity({ schema: 'havit', name: 'routine_exercises' })
export class RoutineExercise {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'routine_id' })
  routine_id!: number;

  @ManyToOne('Routine', 'routine_exercises', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'routine_id' })
  routine!: any;

  @Column({ name: 'exercise_id' })
  exercise_id!: number;

  @ManyToOne(() => Exercise, (exercise) => exercise.routine_exercises, {
    eager: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'exercise_id' })
  exercise!: Exercise;

  @Column({ name: 'order_index', default: 0 })
  order_index!: number;

  @Column({ nullable: true })
  notes?: string;
}