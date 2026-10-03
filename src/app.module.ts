import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { appConfig } from './config/app.config';
import { databaseConfig } from './config/database.config';
import { telegramConfig } from './config/telegram.config';
import { envSchema } from './config/env.validation';
import { instagramConfig } from './config/instagram.config';
import { TelegramModule } from './modules/telegram/telegram.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: envSchema,
      load: [appConfig, databaseConfig, telegramConfig, instagramConfig],
    }),
    TypeOrmModule.forRootAsync(databaseConfig.asProvider()),
    TelegramModule,
  ],
})
export class AppModule {}
