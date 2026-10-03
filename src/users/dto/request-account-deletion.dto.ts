import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestAccountDeletionDto {
  @ApiProperty({
    description:
      'Contraseña actual, para confirmar que quien pide la eliminación es el dueño de la cuenta',
  })
  @IsString()
  @MinLength(1)
  password!: string;
}
