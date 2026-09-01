import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

const MAX_MESSAGE_LENGTH = 2000;

export class SendMessageDto {
  @ApiProperty({
    description: 'Contenido del mensaje',
    example: '¡Nos vemos en el reto mañana!',
    maxLength: MAX_MESSAGE_LENGTH,
  })
  @IsString()
  @IsNotEmpty({ message: 'content cannot be empty' })
  @MaxLength(MAX_MESSAGE_LENGTH, {
    message: `content must be at most ${MAX_MESSAGE_LENGTH} characters`,
  })
  content!: string;
}
