import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Matches, MaxLength } from 'class-validator';
import type { PushPlatform } from '../entities/device-push-token.entity';

/** Expo push tokens look like ExponentPushToken[xxxxxxxx] (or ExpoPushToken[...]). */
const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[^\]]{1,200}\]$/;

export class RemovePushTokenDto {
  @ApiProperty({ example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' })
  @IsString()
  @MaxLength(255)
  @Matches(EXPO_TOKEN_RE, { message: 'token must be an Expo push token' })
  token!: string;
}

export class RegisterPushTokenDto extends RemovePushTokenDto {
  @ApiProperty({ enum: ['ios', 'android'] })
  @IsIn(['ios', 'android'])
  platform!: PushPlatform;
}
