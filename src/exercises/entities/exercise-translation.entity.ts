import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Exercise } from './exercise.entity';

@Entity({ schema: 'havit', name: 'exercise_translations' })
export class ExerciseTranslation {
  @PrimaryColumn({ name: 'exercise_id' })
  exerciseId!: number;

  @PrimaryColumn()
  locale!: string;

  @Column()
  name!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'text', array: true })
  instructions!: string[];

  @Column({ type: 'text', array: true, nullable: true })
  tips?: string[] | null;

  @ManyToOne(() => Exercise, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'exercise_id' })
  exercise!: Exercise;
}
