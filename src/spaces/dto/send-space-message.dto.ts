import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

const MAX_MESSAGE_LENGTH = 2000;

export class SendSpaceMessageDto {
  @ApiProperty({
    description: 'Contenido del mensaje',
    example: '¿A qué hora nos vemos para el entrenamiento?',
    maxLength: MAX_MESSAGE_LENGTH,
  })
  @IsString()
  @IsNotEmpty({ message: 'content cannot be empty' })
  @MaxLength(MAX_MESSAGE_LENGTH, {
    message: `content must be at most ${MAX_MESSAGE_LENGTH} characters`,
  })
  content!: string;
}
