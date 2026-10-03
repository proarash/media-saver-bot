import { registerAs } from '@nestjs/config';
import { parseEnv, type Env } from './env.validation';

export interface TelegramConfig {
  readonly botToken: string;
  readonly webhookDomain: string;
  readonly webhookSecret: string;
}

export const telegramConfig = registerAs('telegram', (): TelegramConfig => {
  const env: Env = parseEnv();
  return {
    botToken: env.BOT_TOKEN,
    webhookDomain: env.WEBHOOK_DOMAIN.replace(/\/$/, ''),
    webhookSecret: env.WEBHOOK_SECRET,
  };
});
