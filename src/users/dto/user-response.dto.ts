import { ApiProperty } from '@nestjs/swagger';
import { User } from '../entities/user.entity';

/**
 * Public shape of a `User` entity. Never includes `password_hash` (or any
 * other secret). Use `UserResponseDto.fromEntity` instead of returning the
 * TypeORM entity directly from any controller/service.
 */
export class UserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  is_active!: boolean;

  static fromEntity(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.username = user.username;
    dto.email = user.email;
    dto.is_active = user.is_active;
    return dto;
  }
}
