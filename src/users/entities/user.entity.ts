
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({schema: 'havit', name: 'users'})
export class User {
  @PrimaryGeneratedColumn()
  id!: string; 

  @Column()
  username!: string;

 @Column({ nullable: true })
  supabase_id?: string;

  @Column({ nullable: true })
  email?: string; 
}