import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import {
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
} from '../notification-catalog';

export class NotificationPreferenceDto {
  @ApiProperty({ enum: NOTIFICATION_CATEGORIES })
  category!: NotificationCategory;

  @ApiProperty({ description: 'Mostrar en la bandeja de la app' })
  inAppEnabled!: boolean;

  @ApiProperty({ description: 'Enviar push al teléfono' })
  pushEnabled!: boolean;

  @ApiProperty({
    description:
      'false si la bandeja no se puede desactivar para esta categoría (moderación sobre tu contenido); el push sí se puede apagar',
  })
  inAppConfigurable!: boolean;
}

export class UpdateCategoryPreferenceDto {
  @ApiProperty({ enum: NOTIFICATION_CATEGORIES })
  @IsIn(NOTIFICATION_CATEGORIES)
  category!: NotificationCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  inAppEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;
}

export class UpdateNotificationPreferencesDto {
  @ApiProperty({ type: [UpdateCategoryPreferenceDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(NOTIFICATION_CATEGORIES.length)
  @ValidateNested({ each: true })
  @Type(() => UpdateCategoryPreferenceDto)
  preferences!: UpdateCategoryPreferenceDto[];
}
