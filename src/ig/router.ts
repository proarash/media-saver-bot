import { Router } from 'express';
import { IgController } from './controller';

export function createIgRouter(controller: IgController): Router {
  const router = Router();

  // POST /telegram/webhook
  router.post('/telegram/webhook', controller.handleTelegramWebhook);

  // GET /ig/user/:username
  router.get('/user/:username', controller.scrapeUser);

  return router;
}
