import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ schema: 'havit', name: 'exercise_body_parts' })
export class ExerciseBodyPart {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  name!: string;
}
