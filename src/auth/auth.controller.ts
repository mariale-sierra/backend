import { Controller } from '@nestjs/common';
import { Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Body } from '@nestjs/common';
import { HttpCode } from '@nestjs/common';  
import { RegisterDto } from './dto/register.dto';
import { UseGuards, Get, Req } from '@nestjs/common';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Iniciar sesión', description: 'Autentica un usuario con email y contraseña' })
  @ApiResponse({ status: 200, description: 'Login exitoso, devuelve token JWT' })
  @ApiResponse({ status: 400, description: 'Credenciales inválidas' })
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('register')
  @HttpCode(200)
  @ApiOperation({ summary: 'Registrar nuevo usuario', description: 'Crea una nueva cuenta de usuario' })
  @ApiResponse({ status: 200, description: 'Registro exitoso' })
  @ApiResponse({ status: 400, description: 'Email ya existe o datos inválidos' })
  register(@Body() regisDto: RegisterDto) {
    return this.authService.register(regisDto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener datos del usuario autenticado', description: 'Devuelve la información del usuario actual basado en el JWT' })
  @ApiResponse({ status: 200, description: 'Datos del usuario' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  getMe(@Req() req) {
    return req.user;
  }


}