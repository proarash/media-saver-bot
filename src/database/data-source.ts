import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../config/database.config';
import { parseEnv } from '../config/env.validation';

// Load .env for standalone use (TypeORM CLI, seeds); Nest's ConfigModule does this for the app.
try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the process environment.
}

/**
 * Used by the TypeORM CLI: `typeorm -d dist/database/data-source.js <command>`.
 * The CLI requires exactly one DataSource export, so keep this the only export.
 */
export default new DataSource(buildDataSourceOptions(parseEnv()));
