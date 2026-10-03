import { Controller } from '@nestjs/common';
import { Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Body } from '@nestjs/common';
import { HttpCode } from '@nestjs/common';
import { RegisterDto } from './dto/register.dto';
import { AcceptTermsDto } from './dto/accept-terms.dto';
import type { AuthenticatedUser } from './decorators/current-user.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { Get, Req } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from './decorators/public.decorator';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Iniciar sesión',
    description: 'Autentica un usuario con email y contraseña',
  })
  @ApiResponse({
    status: 200,
    description: 'Login exitoso, devuelve token JWT',
  })
  @ApiResponse({ status: 400, description: 'Credenciales inválidas' })
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Public()
  @Post('register')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Registrar nuevo usuario',
    description: 'Crea una nueva cuenta de usuario',
  })
  @ApiResponse({ status: 200, description: 'Registro exitoso' })
  @ApiResponse({
    status: 400,
    description: 'Email ya existe o datos inválidos',
  })
  register(@Body() regisDto: RegisterDto) {
    return this.authService.register(regisDto);
  }

  @Post('accept-terms')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Aceptar Términos y Condiciones',
    description:
      'Para cuentas creadas antes de que existiera la aceptación de T&C, o cuando cambia la versión. Registra fecha y versión.',
  })
  @ApiResponse({ status: 200, description: 'Aceptación registrada' })
  @ApiResponse({ status: 400, description: 'Faltan las confirmaciones' })
  acceptTerms(
    @CurrentUser() user: AuthenticatedUser,
    @Body() _dto: AcceptTermsDto,
  ) {
    return this.authService.acceptTerms(user.sub);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Obtener datos del usuario autenticado',
    description: 'Devuelve la información del usuario actual basado en el JWT',
  })
  @ApiResponse({ status: 200, description: 'Datos del usuario' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  getMe(@Req() req) {
    return req.user;
  }
}
