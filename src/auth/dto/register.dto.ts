import {
  Equals,
  IsBoolean,
  IsEmail,
  IsString,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({
    description: 'Email del usuario',
    example: 'usuario@example.com',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    description: 'Contraseña del usuario (mínimo 8 caracteres)',
    example: 'miContraseña123',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({
    description: 'Nombre de usuario único',
    example: 'miUsuario',
  })
  @IsString()
  username!: string;

  @ApiProperty({
    description:
      'Debe ser true: el usuario aceptó los Términos y Condiciones y la Política de Privacidad',
    example: true,
  })
  @IsBoolean()
  @Equals(true, {
    message: 'You must accept the Terms and Conditions and Privacy Policy',
  })
  acceptTerms!: boolean;

  @ApiProperty({
    description: 'Debe ser true: el usuario confirma tener 16 años o más',
    example: true,
  })
  @IsBoolean()
  @Equals(true, { message: 'You must confirm you are at least 16 years old' })
  confirmAge16!: boolean;
}
