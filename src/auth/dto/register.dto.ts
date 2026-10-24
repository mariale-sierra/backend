import { Equals, IsBoolean, IsEmail, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsAcceptablePassword,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
} from '../password-policy';

export class RegisterDto {
  @ApiProperty({
    description: 'Email del usuario',
    example: 'usuario@example.com',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    description: `Contraseña (B4): mínimo ${PASSWORD_MIN_LENGTH} caracteres, máximo ${PASSWORD_MAX_BYTES} bytes, que no sea una contraseña común ni contenga el username o el email. Cada regla incumplida devuelve su propio mensaje.`,
    example: 'Montaña-Lenta-Azul',
    minLength: PASSWORD_MIN_LENGTH,
  })
  @IsString()
  @IsAcceptablePassword()
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
