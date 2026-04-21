import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

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
}