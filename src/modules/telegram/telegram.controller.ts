import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Telegraf } from 'telegraf';
import type { Update } from 'telegraf/types';
import { telegramConfig } from '../../config/telegram.config';
import { TELEGRAF_BOT, TELEGRAM_SECRET_HEADER, TELEGRAM_WEBHOOK_ROUTE } from './telegram.constants';
import type { BotContext } from './types/telegram.types';

@Controller(TELEGRAM_WEBHOOK_ROUTE)
export class TelegramController {
  constructor(
    @Inject(TELEGRAF_BOT) private readonly bot: Telegraf<BotContext>,
    @Inject(telegramConfig.KEY) private readonly config: ConfigType<typeof telegramConfig>,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  public async handleWebhook(
    @Headers(TELEGRAM_SECRET_HEADER) secret: string | undefined,
    @Body() update: Update,
  ): Promise<void> {
    if (secret !== this.config.webhookSecret) {
      throw new UnauthorizedException('Invalid webhook secret');
    }
    await this.bot.handleUpdate(update);
  }
}
