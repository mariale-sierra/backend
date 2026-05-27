import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

import { Challenge } from './challenge.entity';
import { Routine } from '../../routine/entities/routine.entity';

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
    type: 'int',
    nullable: true,
  })
  routine_id!: number | null;

  @ManyToOne(() => Challenge)
  @JoinColumn({ name: 'challenge_id' })
  challenge!: Challenge;

  @ManyToOne(() => Routine, { nullable: true })
  @JoinColumn({ name: 'routine_id' })
  routine?: Routine | null;
}
