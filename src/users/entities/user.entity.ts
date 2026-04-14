import { Entity, PrimaryGeneratedColumn, Column, OneToOne } from 'typeorm';
import { UserProfile } from './user-profile.entity';

@Entity({ schema: 'havit', name: 'users' })
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  username!: string;

  @Column({ unique: true })
  email!: string;

  @Column()
  password_hash!: string;

  @Column({ default: true })
  is_active!: boolean;

  @OneToOne(() => UserProfile, (profile) => profile.user)
  profile?: UserProfile;
}