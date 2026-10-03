import { registerAs } from '@nestjs/config';
import { parseEnv, type Env } from './env.validation';

export interface AppConfig {
  readonly nodeEnv: Env['NODE_ENV'];
  readonly port: number;
}

export const appConfig = registerAs('app', (): AppConfig => {
  const env: Env = parseEnv();
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
  };
});
