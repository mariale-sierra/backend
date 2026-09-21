import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

export type ChallengeStatus = 'open' | 'closed';

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

  @Column('int')
  cycle_length_days!: number;

  // Bloque 1 — admin-only lifecycle status (2026-09-21-02-add-challenge-status.sql):
  // 'closed' blocks joining and logging new progress. Independent of `visibility`
  // (public/private — who can join), and independent of any one participant's own
  // `challenge_user_map.status` (active/completed/left — that user's own relation to
  // it) — this is the challenge itself, for everyone.
  @Column({
    type: 'enum',
    enum: ['open', 'closed'],
    enumName: 'challenge_status_enum',
    default: 'open',
  })
  status!: ChallengeStatus;
}
