import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ schema: 'havit', name: 'muscle_regions' })
export class MuscleRegion {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  code!: string;

  @Column()
  name!: string;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder!: number;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;
}
