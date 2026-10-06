import express from 'express';
import dotenv from 'dotenv';
import { initDatabase } from './ig/db';
import { InstagramService, TelegramService } from './ig/service';
import { IgController } from './ig/controller';
import { createIgRouter } from './ig/router';

dotenv.config();

async function bootstrap() {
  const app = express();
  app.use(express.json());

  // Initialize DB if credentials are provided
  await initDatabase();

  const instagramService = new InstagramService();
  const telegramService = new TelegramService();
  const igController = new IgController(instagramService, telegramService);

  const router = createIgRouter(igController);
  app.use('/', router);
  app.use('/ig', router);

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  const server = app.listen(port, async () => {
    console.log(`[App] Server listening on port ${port}`);

    // Set up Telegram webhook or polling
    const bot = igController.getBot();
    const webhookDomain = process.env.WEBHOOK_DOMAIN;
    const webhookSecret = process.env.WEBHOOK_SECRET;

    if (process.env.BOT_TOKEN && process.env.BOT_TOKEN !== '123456:your-telegram-bot-token') {
      if (webhookDomain && !webhookDomain.includes('your-public-domain.com')) {
        const webhookUrl = `${webhookDomain.replace(/\/$/, '')}/telegram/webhook`;
        try {
          await bot.telegram.setWebhook(webhookUrl, {
            secret_token: webhookSecret,
            drop_pending_updates: true,
          });
          console.log(`[Telegram] Webhook set to: ${webhookUrl}`);
        } catch (err) {
          console.error('[Telegram] Failed to set webhook:', (err as Error).message);
        }
      } else {
        console.log('[Telegram] No public WEBHOOK_DOMAIN specified. Starting Telegraf in polling mode...');
        bot.launch().catch((err) => console.error('[Telegram] Polling error:', err));
      }
    } else {
      console.warn('[Telegram] BOT_TOKEN not configured or using example placeholder.');
    }
  });

  const stop = () => {
    console.log('Shutting down...');
    server.close();
    process.exit(0);
  };

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

bootstrap().catch((err) => {
  console.error('[App] Fatal error starting server:', err);
  process.exit(1);
});
