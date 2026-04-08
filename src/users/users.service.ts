import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  async register(createDto: CreateUserDto, userId: string, email?: string) {
    this.logger.log(`Registering user with username: ${createDto.username}`);
    console.log(`Received userId: ${userId}`);

    const user = this.userRepo.create({
      supabase_id: userId,         
      username: createDto.username,
      email,
    });

    const saved = await this.userRepo.save(user);

    return {
      message: 'User registered successfully',
      user: saved,
    };
  }
}