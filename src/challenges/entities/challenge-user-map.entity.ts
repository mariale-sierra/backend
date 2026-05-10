import { Entity, PrimaryColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Challenge } from './challenge.entity';

@Entity({ schema: 'havit', name: 'challenge_user_map' })
export class ChallengeUserMap {
  @PrimaryColumn({ type: 'uuid' })
  challenge_id!: string;

  @PrimaryColumn({ type: 'uuid' })
  user_id!: string;

  @Column({ default: 'participant' })
  role?: string;

  @CreateDateColumn()
  joined_at?: Date;

  @Column({ default: 'active' })
  status?: string;

  @ManyToOne(() => Challenge)
  @JoinColumn({ name: 'challenge_id' })
  challenge!: Challenge;
}