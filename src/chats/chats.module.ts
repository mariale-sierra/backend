import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatsService } from './chats.service';
import { SharedContentService } from './shared-content.service';
import { ChatsController } from './chats.controller';
import { DirectConversation } from './entities/direct-conversation.entity';
import { DirectConversationMember } from './entities/direct-conversation-member.entity';
import { DirectMessage } from './entities/direct-message.entity';
import { DirectConversationHiddenBy } from './entities/direct-conversation-hidden-by.entity';
import { User } from '../users/entities/user.entity';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DirectConversation,
      DirectConversationMember,
      DirectMessage,
      DirectConversationHiddenBy,
      User,
    ]),
    forwardRef(() => AuthModule),
    NotificationsModule,
  ],
  controllers: [ChatsController],
  providers: [ChatsService, SharedContentService],
  exports: [ChatsService],
})
export class ChatsModule {}
