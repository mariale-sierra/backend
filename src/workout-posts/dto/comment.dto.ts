import { ApiProperty } from '@nestjs/swagger';
import { CommentAuthorDto } from './comment-author.dto';

export class CommentDto {
  @ApiProperty({ description: 'ID del comentario' })
  id!: number;

  @ApiProperty({ description: 'ID (UUID) del workout post' })
  workoutPostId!: string;

  @ApiProperty({ type: CommentAuthorDto })
  author!: CommentAuthorDto;

  @ApiProperty({ description: 'Contenido del comentario' })
  content!: string;

  @ApiProperty({ description: 'Fecha de creación' })
  createdAt!: Date;
}
