import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Space } from './space.entity';
import { User } from '../../users/entities/user.entity';

export type SpaceJoinRequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled';

/**
 * Maps to havit.space_join_requests (added in
 * 2026-09-02-01-spaces-join-requests-and-activity-category.sql). Only used
 * for PRIVATE spaces — joining a public space writes directly to
 * space_members, no row here. Same separation-of-concerns as
 * ChallengeInvite vs ChallengeUserMap.
 */
@Entity({ schema: 'havit', name: 'space_join_requests' })
export class SpaceJoinRequest {
  // BIGINT GENERATED ALWAYS AS IDENTITY — pg driver returns it as string.
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'uuid' })
  space_id!: string;

  @Column({ type: 'uuid' })
  user_id!: string;

  @Column({
    type: 'enum',
    enum: ['pending', 'approved', 'rejected', 'cancelled'],
    enumName: 'space_join_request_status_enum',
  })
  status!: SpaceJoinRequestStatus;

  @CreateDateColumn()
  requested_at!: Date;

  @Column({ type: 'timestamp', nullable: true })
  responded_at?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  responded_by_user_id?: string | null;

  @ManyToOne(() => Space)
  @JoinColumn({ name: 'space_id' })
  space?: Space;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;
}
