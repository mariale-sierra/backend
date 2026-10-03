import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  REPORT_REASONS,
  REPORT_RESOLUTION_ACTIONS,
  REPORT_TARGET_TYPES,
} from '../entities/content-report.entity';
import type {
  ReportReason,
  ReportResolutionAction,
  ReportStatus,
  ReportTargetType,
} from '../entities/content-report.entity';

const MAX_DETAILS_LENGTH = 500;

export class CreateReportDto {
  @ApiProperty({ enum: REPORT_TARGET_TYPES, example: 'post' })
  @IsIn(REPORT_TARGET_TYPES)
  targetType!: ReportTargetType;

  @ApiProperty({
    description: 'UUID del post, o id numérico del comentario',
    example: '6f1c2c1e-7a55-4a8e-9a3e-0b0f7c2d1a11',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  targetId!: string;

  @ApiProperty({ enum: REPORT_REASONS, example: 'spam' })
  @IsIn(REPORT_REASONS)
  reason!: ReportReason;

  @ApiPropertyOptional({ maxLength: MAX_DETAILS_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DETAILS_LENGTH)
  details?: string;
}

export class ResolveReportDto {
  @ApiProperty({
    enum: REPORT_RESOLUTION_ACTIONS,
    description:
      "'dismiss' descarta el reporte; 'hide' oculta el contenido reportado",
  })
  @IsIn(REPORT_RESOLUTION_ACTIONS)
  action!: ReportResolutionAction;

  @ApiPropertyOptional({
    description:
      "Solo con action='hide': registra un strike contra el autor del contenido",
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  penalize?: boolean;

  @ApiPropertyOptional({ maxLength: MAX_DETAILS_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DETAILS_LENGTH)
  note?: string;
}

export class PendingReportsQueryDto {
  @ApiPropertyOptional({ description: 'Keyset: id del último reporte visto' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  after?: number;

  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class ReportTargetPreviewDto {
  exists!: boolean;
  isHidden!: boolean;
  /** Post: caption. Comment: comment text. */
  text!: string | null;
  /** Post photo, or the parent post's photo for a comment. */
  imageUrl!: string | null;
  /** For comments: the parent post id. */
  postId!: string | null;
}

export class ReportDto {
  id!: number;
  targetType!: ReportTargetType;
  targetId!: string;
  reason!: ReportReason;
  details!: string | null;
  status!: ReportStatus;
  createdAt!: Date;
  reporter!: { id: string; username: string };
  targetOwner!: { id: string; username: string; strikeCount: number };
  target!: ReportTargetPreviewDto;
}

export class ResolveReportResultDto {
  reportId!: number;
  status!: ReportStatus;
  action!: ReportResolutionAction;
  contentHidden!: boolean;
  penaltyRecorded!: boolean;
  /** Other pending reports on the same content resolved together with this one. */
  alsoResolvedReportIds!: number[];
}
