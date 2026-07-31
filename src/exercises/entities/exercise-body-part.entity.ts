import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ schema: 'havit', name: 'body_parts' })
export class ExerciseBodyPart {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'parent_id', type: 'int', nullable: true })
  parentId?: number | null;

  @Column({ unique: true })
  code!: string;

  @Column()
  name!: string;

  @Column()
  level!: number;

  @Column({ name: 'sort_order', type: 'int', nullable: true })
  sortOrder?: number | null;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;
}
