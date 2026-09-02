import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Space } from './space.entity';
import { User } from '../../users/entities/user.entity';

export type SpaceMemberRole = 'owner' | 'admin' | 'member';

@Entity({ schema: 'havit', name: 'space_members' })
export class SpaceMember {
  @PrimaryColumn({ type: 'uuid' })
  space_id!: string;

  @PrimaryColumn({ type: 'uuid' })
  user_id!: string;

  @Column({
    type: 'enum',
    enum: ['owner', 'admin', 'member'],
    enumName: 'space_member_role_enum',
  })
  role!: SpaceMemberRole;

  @CreateDateColumn()
  joined_at!: Date;

  @Column({ default: true })
  is_active!: boolean;

  @ManyToOne(() => Space)
  @JoinColumn({ name: 'space_id' })
  space?: Space;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;
}
