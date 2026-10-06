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

  // B1 — added purely to back cursor pagination's keyset ordering (see
  // database/migrations/…-add-challenges-created-at.sql and
  // ChallengesService.findAll()). DEFAULT now() backfills every existing
  // row at migration time; a UUID PK alone isn't chronologically ordered.
  @Column({ type: 'timestamptz', default: () => 'now()' })
  created_at!: Date;

  // Sprint 9, B4 — owner soft delete (2026-10-06-02-add-challenges-is-active.sql).
  // `false` means the creator deleted it: every read treats it as nonexistent,
  // while challenge_user_map, join requests and workout history are kept.
  // Independent of `status` (open/closed is the functional lifecycle).
  @Column({ default: true })
  is_active!: boolean;
}
