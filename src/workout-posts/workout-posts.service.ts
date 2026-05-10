import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { WorkoutPost } from "./entities/workout-post.entity";

@Injectable()
export class WorkoutPostsService {
  constructor(
    @InjectRepository(WorkoutPost)
    private repo: Repository<WorkoutPost>,
  ) {}

  async create(data: Partial<WorkoutPost>) {
    const post = this.repo.create(data);
    return this.repo.save(post);
  }
}