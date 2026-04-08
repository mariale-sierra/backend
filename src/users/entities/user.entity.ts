
import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryColumn()
  id: string; // 👈 UUID de Supabase

  @Column()
  username: string;

  @Column({ nullable: true })
  email?: string; // opcional
}