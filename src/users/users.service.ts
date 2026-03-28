import { Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Logger } from '@nestjs/common';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  register(createDto: CreateUserDto) {
    this.logger.log(`Registering user with username: ${createDto.username}`); 

    /**
     * por el momento se deja id como date now porq no hay bd corriendo
     * cuando exista se usa autoincrement o UUID
     */
    const createdUser = {
      id: Date.now(),
      username: createDto.username,
    }

    return {
      message: 'User registered successfully',
      user: [createdUser]
    };
  }

  findAll() {
    return `This action returns all users`;
  }

  findOne(id: number) {
    return `This action returns a #${id} user`;
  }

  update(id: number, updateUserDto: UpdateUserDto) {
    return `This action updates a #${id} user`;
  }

  remove(id: number) {
    return `This action removes a #${id} user`;
  }
}
