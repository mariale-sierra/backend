import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ schema: 'havit', name: 'challenges' })
export class Challenge {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  created_by_user_id!: string; 

  @Column()
  name!: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ nullable: true })
  instructions?: string;

  @Column()
  visibility!: string;

  @Column()
  duration_days!: number;

  @Column({ nullable: true })
  cycle_length_days?: number;
}