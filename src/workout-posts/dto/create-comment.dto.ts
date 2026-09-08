import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

const MAX_COMMENT_LENGTH = 500;

export class CreateCommentDto {
  @ApiProperty({
    description: 'Contenido del comentario',
    example: '¡Gran progreso!',
    maxLength: MAX_COMMENT_LENGTH,
  })
  @IsString()
  @IsNotEmpty({ message: 'content cannot be empty' })
  @MaxLength(MAX_COMMENT_LENGTH, {
    message: `content must be at most ${MAX_COMMENT_LENGTH} characters`,
  })
  content!: string;
}
