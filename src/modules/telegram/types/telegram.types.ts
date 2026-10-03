import type { Context } from 'telegraf';

export interface BotContext extends Context {
  /** Resolved per update by the auth middleware from `ctx.from.id`. */
  isAdmin: boolean;
}

export interface TelegramUserPayload {
  uid: string;
  full_name: string | null;
  username: string | null;
  lang: string | null;
}

export interface UsersPage {
  users: { uid: string; full_name: string | null; username: string | null }[];
  page: number;
  totalPages: number;
  total: number;
}
