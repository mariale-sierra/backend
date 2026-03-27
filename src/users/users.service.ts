import { Injectable } from '@nestjs/common';
import { RegisterUserDto } from './dto/register-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Logger } from '@nestjs/common';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  register(registerUserDto: RegisterUserDto) {
    this.logger.log(`Registering user with email: ${registerUserDto.email}`); 

    /**
     * por el momento se deja id como date now porq no hay bd corriendo
     * cuando exista se usa autoincrement o UUID
     */
    const createdUser = {
      id: Date.now(),
      email: registerUserDto.email,
      username: registerUserDto.username,
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
