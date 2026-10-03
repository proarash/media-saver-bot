import { registerAs } from '@nestjs/config';
import { parseEnv, type Env } from './env.validation';

export interface InstagramCookies {
  readonly csrftoken: string;
  readonly datr: string;
  readonly ig_did: string;
  readonly mid: string;
  readonly ds_user_id: string;
  readonly sessionid: string;
  readonly rur: string;
}

export interface InstagramConfig {
  readonly csrfToken: string;
  readonly lsd: string;
  readonly cookies: InstagramCookies;
}

export const instagramConfig = registerAs('instagram', (): InstagramConfig => {
  const env: Env = parseEnv();
  return {
    csrfToken: env.IG_CSRF_TOKEN,
    lsd: env.IG_LSD,
    cookies: {
      csrftoken: env.IG_CSRF_TOKEN,
      datr: env.IG_DATR,
      ig_did: env.IG_DID,
      mid: env.IG_MID,
      ds_user_id: env.IG_DS_USER_ID,
      sessionid: env.IG_SESSION_ID,
      rur: env.IG_RUR,
    },
  };
});
