import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  // 👇 1) CONSTRUCTOR (inyección del repo)
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  // 👇 2) MÉTODO (lógica de negocio)
  async create(createDto: CreateUserDto, userId: string, email?: string) {
    this.logger.log(Registering user with username: ${createDto.username});

    const user = this.userRepo.create({
      id: userId,          // viene de Supabase
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