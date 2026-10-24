import { Controller } from '@nestjs/common';
import { Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Body } from '@nestjs/common';
import { HttpCode } from '@nestjs/common';
import { RegisterDto } from './dto/register.dto';
import { AcceptTermsDto } from './dto/accept-terms.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
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

/**
 * B4: own limit for sign-ups (per IP), on top of the global one — creating
 * accounts in bulk, or probing which emails/usernames exist, is throttled.
 * THROTTLE_REGISTER_LIMIT exists only so the e2e suite (which registers a
 * user per test) can raise it; never set it in a real deployment.
 */
const REGISTER_THROTTLE = {
  limit: () => parseInt(process.env.THROTTLE_REGISTER_LIMIT ?? '5', 10),
  ttl: 10 * 60_000,
};

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
    description:
      'Login exitoso: { accessToken (JWT de 15 min), refreshToken (opaco, 30 días, rotativo), user }',
  })
  @ApiResponse({
    status: 401,
    description:
      'Credenciales inválidas (mismo mensaje y mismo tiempo exista o no el email). "This account has been deactivated" solo con la contraseña correcta.',
  })
  @ApiResponse({ status: 429, description: 'Más de 10 intentos por minuto' })
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Public()
  @Throttle({ default: REGISTER_THROTTLE })
  @Post('register')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Registrar nuevo usuario',
    description: 'Crea una nueva cuenta de usuario',
  })
  @ApiResponse({
    status: 200,
    description:
      'Registro exitoso: { message, accessToken, refreshToken, user }',
  })
  @ApiResponse({
    status: 400,
    description:
      'Datos inválidos, incluida una contraseña que no cumple la política (mensaje específico por regla)',
  })
  @ApiResponse({
    status: 409,
    description:
      '"Email or username already in use": el mismo mensaje para ambos casos',
  })
  @ApiResponse({
    status: 429,
    description: 'Más de 5 registros por IP en 10 min',
  })
  register(@Body() regisDto: RegisterDto) {
    return this.authService.register(regisDto);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Renovar la sesión',
    description:
      'Canjea el refresh token por un access token nuevo y un refresh token nuevo (rotación: el usado deja de valer). Reusar un refresh token ya rotado revoca la sesión entera.',
  })
  @ApiResponse({
    status: 200,
    description: '{ accessToken, refreshToken, user }',
  })
  @ApiResponse({
    status: 401,
    description:
      '"Invalid refresh token": desconocido, vencido, revocado, reusado o cuenta no utilizable',
  })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  // Public: closing a session must work with an expired access token too.
  // Holding the refresh token is what authorizes revoking its session.
  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Cerrar sesión',
    description:
      'Revoca la sesión del refresh token (toda su familia). Sus access tokens dejan de valer de inmediato en esta instancia y en ≤30 s en cualquier otra.',
  })
  @ApiResponse({
    status: 204,
    description: 'Siempre, haya o no algo que revocar',
  })
  async logout(@Body() dto: LogoutDto): Promise<void> {
    await this.authService.logout(dto.refreshToken);
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
