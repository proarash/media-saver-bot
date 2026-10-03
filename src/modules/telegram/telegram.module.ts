import { Module, type Provider } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Telegraf } from 'telegraf';
import { telegramConfig } from '../../config/telegram.config';
import { InstagramModule } from '../instagram/instagram.module';
import { Admin } from './entities/admin.entity';
import { BotSettings } from './entities/bot-settings.entity';
import { User } from './entities/user.entity';
import { TELEGRAF_BOT } from './telegram.constants';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';
import { TelegramUpdate } from './telegram.update';
import type { BotContext } from './types/telegram.types';

const botProvider: Provider<Telegraf<BotContext>> = {
  provide: TELEGRAF_BOT,
  inject: [telegramConfig.KEY],
  useFactory: (config: ConfigType<typeof telegramConfig>): Telegraf<BotContext> =>
    new Telegraf<BotContext>(config.botToken),
};

@Module({
  imports: [TypeOrmModule.forFeature([User, Admin, BotSettings]), InstagramModule],
  controllers: [TelegramController],
  providers: [botProvider, TelegramService, TelegramUpdate],
  exports: [TelegramService],
})
export class TelegramModule {}
