import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import { UsersService } from './users.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { UserResponseDto } from './dto/user-response.dto';
import {
  UpdateUserProfileDto,
  UpdateProfilePhotoDto,
} from './dto/update-user-profile.dto';
import {
  ProfileResponseDto,
  PublicProfileResponseDto,
} from './dto/profile-response.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { resolveRequestTimezone } from '../common/timezone.util';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Obtener perfil del usuario',
    description: 'Devuelve los detalles completos del usuario autenticado',
  })
  @ApiOkResponse({
    description: 'Datos del perfil del usuario',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  getMe(@Req() req): Promise<UserResponseDto> {
    return this.usersService.findById(req.user.sub);
  }

  @Get('me/challenges')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Obtener mis desafíos',
    description:
      'Lista todos los desafíos en los que participa el usuario actual',
  })
  @ApiResponse({ status: 200, description: 'Lista de desafíos del usuario' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  getMyChallenges(@Req() req) {
    return this.usersService.getUserChallenges(
      req.user.sub,
      resolveRequestTimezone(req),
    );
  }

  @Get('me/profile')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Obtener mi perfil editable',
    description:
      'Perfil completo del usuario autenticado (display name, bio, idioma, foto, privacidad).',
  })
  @ApiOkResponse({ type: ProfileResponseDto })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  getMyProfile(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProfileResponseDto> {
    return this.usersService.getMyProfile(user.sub);
  }

  @Patch('me/profile')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Editar mi perfil',
    description:
      'Actualización parcial: solo los campos enviados se modifican (display_name, bio, preferred_language, is_private). ' +
      'Username, email y password no son editables por esta vía.',
  })
  @ApiOkResponse({
    description: 'Perfil actualizado',
    type: ProfileResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Campos inválidos (longitud, idioma no soportado, campos no permitidos)',
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  updateMyProfile(
    @Body() dto: UpdateUserProfileDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProfileResponseDto> {
    return this.usersService.updateProfile(user.sub, dto);
  }

  @Patch('me/profile/photo')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Actualizar foto de perfil',
    description:
      'Guarda la URL pública generada por el flujo de subida existente (POST /uploads/sign + PUT directo a R2).',
  })
  @ApiOkResponse({ description: 'Foto actualizada', type: ProfileResponseDto })
  @ApiResponse({ status: 400, description: 'URL inválida' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  updateMyProfilePhoto(
    @Body() dto: UpdateProfilePhotoDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProfileResponseDto> {
    return this.usersService.updateProfilePhoto(
      user.sub,
      dto.profile_image_url,
    );
  }

  @Get('search')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Buscar usuarios',
    description:
      'Búsqueda por username (contiene, sin distinguir mayúsculas). Usada por el flujo de invitaciones. Máximo 20 resultados, nunca incluye al propio usuario ni emails.',
  })
  @ApiQuery({
    name: 'q',
    description: 'Texto a buscar en el username',
    required: true,
  })
  @ApiOkResponse({ type: PublicProfileResponseDto, isArray: true })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  searchUsers(
    @Query('q') query: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PublicProfileResponseDto[]> {
    return this.usersService.searchUsers(query ?? '', user.sub);
  }

  @Get(':id/profile')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Perfil público de otro usuario',
    description:
      'Vista pública que respeta la privacidad configurada: los perfiles privados no exponen bio, salvo al propio dueño o a un seguidor activo. Nunca expone email.',
  })
  @ApiParam({ name: 'id', description: 'ID (UUID) del usuario' })
  @ApiOkResponse({ type: PublicProfileResponseDto })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado o inactivo' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  getPublicProfile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PublicProfileResponseDto> {
    return this.usersService.getPublicProfile(id, user.sub);
  }
}
