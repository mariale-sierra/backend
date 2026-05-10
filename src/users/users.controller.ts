import { Controller, Get, UseGuards, Req, Query } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener perfil del usuario', description: 'Devuelve los detalles completos del usuario autenticado' })
  @ApiResponse({ status: 200, description: 'Datos del perfil del usuario' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  getMe(@Req() req) {
    return this.usersService.findById(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
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