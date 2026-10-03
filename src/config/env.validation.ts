import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value: 'true' | 'false'): boolean => value === 'true');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),

  BOT_TOKEN: z.string().min(1),
  WEBHOOK_DOMAIN: z.url(),
  WEBHOOK_SECRET: z.string().min(1),

  /** Comma separated Telegram user ids, e.g. `4321,1234`. */
  ADMINS_LIST: z
    .string()
    .default('')
    .transform((value: string): string[] =>
      value
        .split(',')
        .map((uid: string): string => uid.trim())
        .filter((uid: string): boolean => uid !== ''),
    )
    .pipe(z.array(z.string().regex(/^\d+$/, 'ADMINS_LIST must contain numeric Telegram ids'))),

  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().default(3306),
  DB_USERNAME: z.string().default('root'),
  DB_PASSWORD: z.string().default(''),
  DB_DATABASE: z.string().min(1),
  DB_LOGGING: booleanString,

  IG_CSRF_TOKEN: z.string().min(1),
  IG_LSD: z.string().min(1),
  IG_DATR: z.string().min(1),
  IG_DID: z.string().min(1),
  IG_MID: z.string().min(1),
  IG_DS_USER_ID: z.string().min(1),
  IG_SESSION_ID: z.string().min(1),
  IG_RUR: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(): Env {
  return envSchema.parse(process.env);
}
