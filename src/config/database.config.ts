import { join } from 'node:path';
import { registerAs } from '@nestjs/config';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import type { DataSourceOptions } from 'typeorm';
import { parseEnv, type Env } from './env.validation';

/** Shared by the Nest app and the TypeORM CLI data source. Schema changes go through migrations only. */
export function buildDataSourceOptions(env: Env): DataSourceOptions {
  return {
    type: 'mysql',
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: env.DB_DATABASE,
    charset: 'utf8mb4',
    synchronize: false,
    logging: env.DB_LOGGING,
    entities: [join(__dirname, '..', '**', '*.entity.js')],
    migrations: [join(__dirname, '..', 'database', 'migrations', '*.js')],
    migrationsTableName: 'migrations',
  };
}

export const databaseConfig = registerAs(
  'database',
  (): TypeOrmModuleOptions => ({
    ...buildDataSourceOptions(parseEnv()),
    autoLoadEntities: true,
  }),
);
