import { Controller } from '@nestjs/common';
import { Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Body } from '@nestjs/common';
import { HttpCode } from '@nestjs/common';  
import { RegisterDto } from './dto/register.dto';
import { UseGuards, Get, Req } from '@nestjs/common';
import { SupabaseAuthGuard } from './guards/supabase-auth.guard';


@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200) 
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('register')
  @HttpCode(200) 
  register(@Body() regisDto: RegisterDto) {
    return this.authService.register(regisDto);
  }

  @Get('me')
  @UseGuards(SupabaseAuthGuard)
  getMe(@Req() req) {
    return req.user;
  }


}