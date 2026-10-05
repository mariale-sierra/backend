import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './entities/notification.entity';
import { NotificationType } from './entities/notification-type.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { DevicePushToken } from './entities/device-push-token.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { PushTokensService } from './push-tokens.service';
import { ExpoPushService } from './expo-push.service';
import { AuthModule } from '../auth/auth.module';

/**
 * Depends only on its own tables + users (plus AuthModule for the
 * controller's guard, via forwardRef — AuthModule -> UsersModule ->
 * FollowsModule -> NotificationsModule would otherwise be a cycle), so
 * every domain module can import it to call NotificationsService.notify().
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Notification,
      NotificationType,
      NotificationPreference,
      DevicePushToken,
      User,
    ]),
    forwardRef(() => AuthModule),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, PushTokensService, ExpoPushService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
