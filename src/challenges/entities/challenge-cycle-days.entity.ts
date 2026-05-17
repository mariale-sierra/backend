import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

import { Challenge } from './challenge.entity';

@Entity({
  schema: 'havit',
  name: 'challenge_cycle_days',
})
export class ChallengeCycleDay {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  challenge_id!: string;

  @Column('int')
  day_in_cycle!: number;

  @Column({
    type: 'varchar',
    default: 'workout',
  })
  day_type!: string;

  @Column({
    type: 'uuid',
    nullable: true,
  })
  routine_id!: string | null;

  @ManyToOne(() => Challenge)
  @JoinColumn({ name: 'challenge_id' })
  challenge!: Challenge;
}