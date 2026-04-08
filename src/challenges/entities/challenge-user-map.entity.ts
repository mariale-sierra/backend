import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity({ schema: 'havit', name: 'challenge_user_map' })
export class ChallengeUserMap {
  @PrimaryColumn({ type: 'bigint' })
  challenge_id!: number;

  @PrimaryColumn({ type: 'bigint' })
  user_id!: number;

  @Column({ default: 'participant' })
  role?: string;

  @CreateDateColumn()
  joined_at?: Date;

  @Column({ default: 'active' })
  status?: string;
}