import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Exercise } from './entities/exercise.entity';

@Injectable()
export class ExercisesService {
  constructor(
    @InjectRepository(Exercise)
    private exerciseRepo: Repository<Exercise>,
  ) {}

  async create(dto: any) {
    const exercise = this.exerciseRepo.create(dto);
    return this.exerciseRepo.save(exercise);
  }

  async findAll() {
    return this.exerciseRepo.find({
      where: { is_active: true },
    });
  }
}
