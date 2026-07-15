import { Controller, Get, Req } from '@nestjs/common';
import { UsersService } from './users.service';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiOkResponse } from '@nestjs/swagger';
import { UserResponseDto } from './dto/user-response.dto';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener perfil del usuario', description: 'Devuelve los detalles completos del usuario autenticado' })
  @ApiOkResponse({ description: 'Datos del perfil del usuario', type: UserResponseDto })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  getMe(@Req() req): Promise<UserResponseDto> {
    return this.usersService.findById(req.user.sub);
  }

  @Get('me/challenges')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Obtener mis desafíos',
    description: 'Lista todos los desafíos en los que participa el usuario actual'
  })
  @ApiResponse({ status: 200, description: 'Lista de desafíos del usuario' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  getMyChallenges(@Req() req) {
    return this.usersService.getUserChallenges(req.user.sub);
  }

}