import { ApiProperty } from '@nestjs/swagger';
import { User } from '../entities/user.entity';
import { CURRENT_TERMS_VERSION } from '../../auth/terms-version';

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

  /** Global platform admin — only present on GET /users/me (see UsersService.findById). */
  @ApiProperty()
  is_admin!: boolean;

  /** True when the user never accepted the current Terms/Privacy Policy (GET /users/me only). */
  @ApiProperty()
  requires_terms_acceptance!: boolean;

  static fromEntity(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.username = user.username;
    dto.email = user.email;
    dto.is_active = user.is_active;
    dto.is_admin = user.is_admin;
    dto.requires_terms_acceptance =
      !user.terms_accepted_at || user.terms_version !== CURRENT_TERMS_VERSION;
    return dto;
  }
}
