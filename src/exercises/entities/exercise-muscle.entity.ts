import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Exercise } from './exercise.entity';
import { Muscle } from './muscle.entity';

export type MuscleRole = 'primary' | 'secondary';

@Entity({ schema: 'havit', name: 'exercise_muscles' })
export class ExerciseMuscle {
  @PrimaryColumn({ name: 'exercise_id' })
  exerciseId!: number;

  @PrimaryColumn({ name: 'muscle_id' })
  muscleId!: number;

  @Column({ type: 'enum', enum: ['primary', 'secondary'] })
  role!: MuscleRole;

  @ManyToOne(() => Exercise, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'exercise_id' })
  exercise!: Exercise;

  @ManyToOne(() => Muscle, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'muscle_id' })
  muscle!: Muscle;
}
