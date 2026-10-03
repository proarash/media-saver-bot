import 'reflect-metadata';
import { Logger, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { ConfigType } from '@nestjs/config';
import { AppModule } from './app.module';
import { appConfig } from './config/app.config';

async function bootstrap(): Promise<void> {
  const app: INestApplication = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  const config: ConfigType<typeof appConfig> = app.get(appConfig.KEY);
  await app.listen(config.port);
  Logger.log(`Listening on port ${config.port}`, 'Bootstrap');
}

void bootstrap();
