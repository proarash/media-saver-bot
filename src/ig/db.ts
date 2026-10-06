import 'reflect-metadata';
import { DataSource } from 'typeorm';
import dotenv from 'dotenv';
import { User, Admin, BotSettings } from './entities';

dotenv.config();

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  username: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'media_saver_bot',
  charset: 'utf8mb4',
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
  entities: [User, Admin, BotSettings],
});

export async function initDatabase(): Promise<boolean> {
  try {
    await AppDataSource.initialize();
    console.log('[Database] Connected successfully.');
    return true;
  } catch (err) {
    console.warn('[Database] Connection failed, proceeding with DB in disabled/graceful state:', (err as Error).message);
    return false;
  }
}
