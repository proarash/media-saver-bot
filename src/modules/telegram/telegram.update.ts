import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Markup, Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import type { BotCommand, InlineKeyboardButton } from 'telegraf/types';
import { createZip, type ZipEntry } from '../../common/zip';
import { telegramConfig } from '../../config/telegram.config';
import { InstagramError, InstagramService } from '../instagram/instagram.service';
import { MediaType, type Highlight, type InstagramTarget, type MediaFile, type Profile } from '../instagram/instagram.types';
import type { BotSettings } from './entities/bot-settings.entity';
import { TELEGRAF_BOT, TELEGRAM_WEBHOOK_ROUTE } from './telegram.constants';
import { TelegramService } from './telegram.service';
import type { BotContext, TelegramUserPayload, UsersPage } from './types/telegram.types';

const USERS_PAGE_SIZE = 10;
const MEDIA_GROUP_LIMIT = 10;
/** Telegram bot API upload limit for documents. */
const MAX_ZIP_BYTES = 50 * 1024 * 1024;

const USER_COMMANDS: BotCommand[] = [
  { command: 'start', description: 'Start the bot' },
  { command: 'help', description: 'How to use the bot' },
  { command: 'highlights', description: 'List highlights of a profile' },
];

const ADMIN_COMMANDS: BotCommand[] = [
  ...USER_COMMANDS,
  { command: 'zip', description: 'Download everything as one ZIP' },
  { command: 'users', description: 'List registered users' },
  { command: 'disable', description: 'Toggle bot for non-admins' },
  { command: 'forward', description: 'Toggle forwarding user messages' },
];

const HELP_TEXT: string = [
  'Send me any of these and I will reply with the media:',
  '',
  '• Post link (single image, video or carousel)',
  '• Reel link',
  '• Highlight link (instagram.com/stories/highlights/…)',
  '• Profile link or @username - HD profile picture',
  '',
  '/highlights <username> - pick a highlight to download',
].join('\n');

const ADMIN_HELP_TEXT: string = [
  '',
  '',
  'Admin:',
  '/zip <link | username> - everything in one ZIP',
  '/users - registered users',
  '/disable - toggle bot for non-admins',
  '/forward - toggle forwarding user messages to admins while disabled',
].join('\n');

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** Encodes a target into callback data (Telegram limit: 64 bytes). */
function encodeTarget(target: InstagramTarget): string {
  switch (target.type) {
    case 'post':
      return `p:${target.shortcode}`;
    case 'highlight':
      return `h:${target.id}`;
    case 'profile':
      return `u:${target.username}`;
  }
}

function decodeTarget(data: string): InstagramTarget | null {
  const [kind, value] = [data.slice(0, 1), data.slice(2)];
  if (value === '') return null;
  if (kind === 'p') return { type: 'post', shortcode: value };
  if (kind === 'h') return { type: 'highlight', id: value };
  if (kind === 'u') return { type: 'profile', username: value };
  return null;
}

/** Registers bot handlers and the Telegram webhook on startup. */
@Injectable()
export class TelegramUpdate implements OnApplicationBootstrap {
  private readonly logger: Logger = new Logger(TelegramUpdate.name);

  constructor(
    @Inject(TELEGRAF_BOT) private readonly bot: Telegraf<BotContext>,
    @Inject(telegramConfig.KEY) private readonly config: ConfigType<typeof telegramConfig>,
    private readonly service: TelegramService,
    private readonly instagram: InstagramService,
  ) {}

  public async onApplicationBootstrap(): Promise<void> {
    this.registerHandlers();
    const url: string = `${this.config.webhookDomain}/${TELEGRAM_WEBHOOK_ROUTE}`;
    await this.bot.telegram.setWebhook(url, { secret_token: this.config.webhookSecret });
    await this.bot.telegram.setMyCommands(USER_COMMANDS);
    this.logger.log(`Webhook set to ${url}`);
  }

  private registerHandlers(): void {
    this.bot.use(async (ctx: BotContext, next: () => Promise<void>): Promise<void> => this.gate(ctx, next));

    this.bot.start((ctx: BotContext): Promise<void> => this.onStart(ctx));

    this.bot.help(async (ctx: BotContext): Promise<void> => {
      await ctx.reply(ctx.isAdmin ? HELP_TEXT + ADMIN_HELP_TEXT : HELP_TEXT);
    });

    this.bot.command('highlights', async (ctx): Promise<void> => {
      const username: string = ctx.payload.trim().replace(/^@/, '');
      if (username === '') {
        await ctx.reply('Usage: /highlights <username>');
        return;
      }
      await this.safely(ctx, async (): Promise<void> => {
        const profile: Profile = await this.instagram.getProfile(username);
        await this.sendHighlightsList(ctx, profile.id);
      });
    });

    this.bot.command('zip', async (ctx): Promise<void> => {
      if (!ctx.isAdmin) {
        await ctx.reply('ZIP mode is available for admins only.');
        return;
      }
      const target: InstagramTarget | null = this.instagram.parseTarget(ctx.payload);
      if (target === null) {
        await ctx.reply('Usage: /zip <post | reel | highlight link | username>');
        return;
      }
      await this.sendZip(ctx, target);
    });

    this.bot.command('users', async (ctx): Promise<void> => {
      if (!ctx.isAdmin) return;
      const page: UsersPage = await this.service.listUsers(1, USERS_PAGE_SIZE);
      await ctx.reply(this.renderUsers(page), {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...this.usersKeyboard(page),
      });
    });

    this.bot.command('disable', async (ctx): Promise<void> => {
      if (!ctx.isAdmin) return;
      const settings: BotSettings = await this.service.toggleDisabled();
      await ctx.reply(
        settings.disabled
          ? '🔴 Bot disabled. Only admins can use it now.'
          : '🟢 Bot enabled for everyone.',
      );
    });

    this.bot.command('forward', async (ctx): Promise<void> => {
      if (!ctx.isAdmin) return;
      const settings: BotSettings = await this.service.toggleForward();
      await ctx.reply(
        settings.forward_enabled
          ? '📨 Forwarding ON. While the bot is disabled, user messages are forwarded to admins.'
          : '📭 Forwarding OFF.',
      );
    });

    this.bot.action(/^users:(\d+)$/, async (ctx): Promise<void> => {
      if (!ctx.isAdmin) {
        await ctx.answerCbQuery();
        return;
      }
      const page: UsersPage = await this.service.listUsers(Number(ctx.match[1]), USERS_PAGE_SIZE);
      await ctx.answerCbQuery();
      await ctx
        .editMessageText(this.renderUsers(page), {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          ...this.usersKeyboard(page),
        })
        .catch((): void => undefined); // "message is not modified"
    });

    this.bot.action('noop', async (ctx): Promise<void> => {
      await ctx.answerCbQuery();
    });

    this.bot.action(/^hls:(\d+)$/, async (ctx): Promise<void> => {
      await ctx.answerCbQuery();
      const userId: string = ctx.match[1] ?? '';
      await this.safely(ctx, (): Promise<void> => this.sendHighlightsList(ctx, userId));
    });

    this.bot.action(/^hl:(\d+)$/, async (ctx): Promise<void> => {
      await ctx.answerCbQuery('Fetching highlight…');
      await this.handleTarget(ctx, { type: 'highlight', id: ctx.match[1] ?? '' });
    });

    this.bot.action(/^zip:(.+)$/, async (ctx): Promise<void> => {
      if (!ctx.isAdmin) {
        await ctx.answerCbQuery('Admins only');
        return;
      }
      const target: InstagramTarget | null = decodeTarget(ctx.match[1] ?? '');
      await ctx.answerCbQuery(target === null ? 'Invalid request' : 'Building ZIP…');
      if (target !== null) await this.sendZip(ctx, target);
    });

    this.bot.on(message('contact'), async (ctx): Promise<void> => {
      await this.service.setPhoneNumber(String(ctx.from.id), ctx.message.contact.phone_number);
      await ctx.reply('Phone number saved.');
    });

    this.bot.on(message('text'), async (ctx): Promise<void> => {
      const target: InstagramTarget | null = ctx.message.text.startsWith('/')
        ? null
        : this.instagram.parseTarget(ctx.message.text);
      if (target === null) {
        await ctx.reply(HELP_TEXT);
        return;
      }
      await this.handleTarget(ctx, target);
    });

    this.bot.catch((err: unknown, ctx: BotContext): void => {
      this.logger.error(`Error on update ${ctx.update.update_id}`, err instanceof Error ? err.stack : String(err));
    });
  }

  /**
   * Runs before every handler: resolves admin status, registers users on /start,
   * and blocks non-admins while the bot is disabled (forwarding their messages if enabled).
   */
  private async gate(ctx: BotContext, next: () => Promise<void>): Promise<void> {
    ctx.isAdmin = false;
    if (ctx.from === undefined) return next();

    const uid: string = String(ctx.from.id);
    ctx.isAdmin = await this.service.isAdmin(uid);

    if (ctx.message !== undefined && 'text' in ctx.message && /^\/start(?:@\w+)?(?:\s|$)/.test(ctx.message.text)) {
      await this.service.upsertUser(this.service.toPayload(ctx.from));
    }

    if (ctx.isAdmin) return next();

    const settings: BotSettings = await this.service.getSettings();
    if (!settings.disabled) return next();

    if (settings.forward_enabled && ctx.message !== undefined && ctx.chat !== undefined) {
      await this.forwardToAdmins(ctx, ctx.chat.id, ctx.message.message_id);
    }
    if (ctx.callbackQuery !== undefined) await ctx.answerCbQuery().catch((): void => undefined);
  }

  private async forwardToAdmins(ctx: BotContext, chatId: number, messageId: number): Promise<void> {
    if (ctx.from === undefined) return;
    const payload: TelegramUserPayload = this.service.toPayload(ctx.from);
    const name: string = escapeHtml(payload.full_name ?? payload.username ?? payload.uid);
    const header: string = `📨 From <a href="tg://user?id=${payload.uid}">${name}</a> (<code>${payload.uid}</code>)`;

    for (const adminUid of await this.service.getAdminUids()) {
      try {
        await ctx.telegram.sendMessage(adminUid, header, { parse_mode: 'HTML' });
        await ctx.telegram.forwardMessage(adminUid, chatId, messageId);
      } catch (err: unknown) {
        this.logger.warn(`Forward to admin ${adminUid} failed: ${String(err)}`);
      }
    }
  }

  private async onStart(ctx: BotContext): Promise<void> {
    if (ctx.from === undefined || ctx.chat === undefined) return;
    const payload: TelegramUserPayload = this.service.toPayload(ctx.from);
    const name: string = payload.full_name !== null ? `, ${payload.full_name}` : '';

    if (!ctx.isAdmin) {
      await ctx.reply(`Welcome${name}!\n\n${HELP_TEXT}`);
      return;
    }

    await this.bot.telegram
      .setMyCommands(ADMIN_COMMANDS, { scope: { type: 'chat', chat_id: ctx.chat.id } })
      .catch((err: unknown): void => this.logger.warn(`setMyCommands failed: ${String(err)}`));
    await ctx.reply(
      `Welcome${name}! (admin)\n\n${HELP_TEXT}${ADMIN_HELP_TEXT}`,
      Markup.keyboard([['/users'], ['/disable', '/forward']]).resize(),
    );
  }

  /* ---------------------------- Media delivery ---------------------------- */

  private async handleTarget(ctx: BotContext, target: InstagramTarget): Promise<void> {
    await this.safely(ctx, async (): Promise<void> => {
      await ctx.sendChatAction('upload_photo').catch((): void => undefined);

      if (target.type === 'profile') {
        await this.sendProfile(ctx, await this.instagram.getProfile(target.username));
        return;
      }

      const files: MediaFile[] =
        target.type === 'post'
          ? await this.instagram.getPostMedia(target.shortcode)
          : await this.instagram.getHighlightMedia(target.id);

      await this.sendMedia(ctx, files);
      if (ctx.isAdmin && files.length > 1) {
        await ctx.reply(
          '📦 Want everything in one file?',
          Markup.inlineKeyboard([Markup.button.callback('Download all as ZIP', `zip:${encodeTarget(target)}`)]),
        );
      }
    });
  }

  private async sendProfile(ctx: BotContext, profile: Profile): Promise<void> {
    const title: string = profile.fullName !== null ? `${profile.fullName} (@${profile.username})` : `@${profile.username}`;
    const buttons: InlineKeyboardButton[][] = [[Markup.button.callback('✨ Highlights', `hls:${profile.id}`)]];
    if (ctx.isAdmin) {
      buttons.push([Markup.button.callback('📦 Everything as ZIP', `zip:u:${profile.username}`)]);
    }
    await this.sendSingle(ctx, { type: MediaType.Photo, url: profile.hdProfilePicUrl }, this.caption(ctx, title), buttons);
  }

  private async sendHighlightsList(ctx: BotContext, userId: string): Promise<void> {
    const highlights: Highlight[] = await this.instagram.getHighlights(userId);
    if (highlights.length === 0) {
      await ctx.reply('This profile has no highlights.');
      return;
    }
    const buttons: InlineKeyboardButton[][] = chunk(
      highlights.map((h: Highlight): InlineKeyboardButton =>
        Markup.button.callback(h.title !== '' ? h.title.slice(0, 40) : h.id, `hl:${h.id}`),
      ),
      2,
    );
    await ctx.reply('Choose a highlight:', Markup.inlineKeyboard(buttons));
  }

  /** Replies with photo / video / media group by URL; Telegram fetches the files itself. */
  private async sendMedia(ctx: BotContext, files: readonly MediaFile[]): Promise<void> {
    if (files.length === 0) {
      await ctx.reply('No media found.');
      return;
    }
    const caption: string = this.caption(ctx);
    const [first] = files;
    if (files.length === 1 && first !== undefined) {
      await this.sendSingle(ctx, first, caption);
      return;
    }

    for (const group of chunk(files, MEDIA_GROUP_LIMIT)) {
      if (group.length === 1 && group[0] !== undefined) {
        await this.sendSingle(ctx, group[0], caption);
        continue;
      }
      try {
        await ctx.replyWithMediaGroup(
          group.map((file: MediaFile, index: number) => ({
            type: file.type === MediaType.Video ? ('video' as const) : ('photo' as const),
            media: file.url,
            ...(index === 0 ? { caption } : {}),
          })),
        );
      } catch (err: unknown) {
        this.logger.warn(`Media group failed, sending items one by one: ${String(err)}`);
        for (const file of group) await this.sendSingle(ctx, file, caption);
      }
    }
  }

  /** Sends one file by its type, falling back to a document and finally to a plain link. */
  private async sendSingle(
    ctx: BotContext,
    file: MediaFile,
    caption: string,
    buttons: InlineKeyboardButton[][] = [],
  ): Promise<void> {
    const extra = { caption, ...(buttons.length > 0 ? Markup.inlineKeyboard(buttons) : {}) };
    try {
      switch (file.type) {
        case MediaType.Photo:
          await ctx.replyWithPhoto(file.url, extra);
          return;
        case MediaType.Video:
          await ctx.replyWithVideo(file.url, { ...extra, supports_streaming: true });
          return;
        case MediaType.Document:
          await ctx.replyWithDocument(file.url, extra);
          return;
      }
    } catch (err: unknown) {
      this.logger.warn(`Sending ${file.type} by URL failed: ${String(err)}`);
    }
    if (file.type !== MediaType.Document) {
      try {
        // Photos over 5MB / videos over 20MB are rejected as media but may still pass as documents.
        await ctx.replyWithDocument(file.url, extra);
        return;
      } catch (err: unknown) {
        this.logger.warn(`Document fallback failed: ${String(err)}`);
      }
    }
    await ctx.reply(`<a href="${escapeHtml(file.url)}">Open ${file.type}</a>\n\n${escapeHtml(caption)}`, {
      parse_mode: 'HTML',
      ...(buttons.length > 0 ? Markup.inlineKeyboard(buttons) : {}),
    });
  }

  /** Bot name is appended at the end of every media caption. */
  private caption(ctx: BotContext, text?: string): string {
    const signature: string = `@${ctx.botInfo.username}`;
    return text !== undefined && text !== '' ? `${text}\n\n${signature}` : signature;
  }

  /* ------------------------------ ZIP (admin) ----------------------------- */

  private async collectZipFiles(target: InstagramTarget): Promise<{ name: string; files: { path: string; file: MediaFile }[] }> {
    const numbered = (files: readonly MediaFile[], prefix: string): { path: string; file: MediaFile }[] =>
      files.map((file: MediaFile, i: number) => ({ path: `${prefix}${i + 1}`, file }));

    switch (target.type) {
      case 'post':
        return { name: target.shortcode, files: numbered(await this.instagram.getPostMedia(target.shortcode), '') };
      case 'highlight':
        return { name: `highlight_${target.id}`, files: numbered(await this.instagram.getHighlightMedia(target.id), '') };
      case 'profile': {
        const profile: Profile = await this.instagram.getProfile(target.username);
        const files: { path: string; file: MediaFile }[] = [
          { path: 'profile_pic_hd', file: { type: MediaType.Photo, url: profile.hdProfilePicUrl } },
        ];
        for (const highlight of await this.instagram.getHighlights(profile.id)) {
          const folder: string = `highlights/${(highlight.title || highlight.id).replace(/[\\/:*?"<>|]/g, '_')}_${highlight.id}/`;
          files.push(...numbered(await this.instagram.getHighlightMedia(highlight.id), folder));
        }
        return { name: profile.username, files };
      }
    }
  }

  /** Media is fetched into memory and zipped there; nothing touches the disk. */
  private async sendZip(ctx: BotContext, target: InstagramTarget): Promise<void> {
    await this.safely(ctx, async (): Promise<void> => {
      await ctx.sendChatAction('upload_document').catch((): void => undefined);
      const { name, files } = await this.collectZipFiles(target);
      if (files.length === 0) {
        await ctx.reply('No media found.');
        return;
      }

      const entries: ZipEntry[] = [];
      let total: number = 0;
      for (const { path, file } of files) {
        const data: Buffer = await this.instagram.fetchBuffer(file.url);
        total += data.length;
        if (total > MAX_ZIP_BYTES) {
          await ctx.reply(`⚠️ ZIP would exceed Telegram's 50MB limit; stopped after ${entries.length} files.`);
          break;
        }
        entries.push({ name: `${path}.${file.type === MediaType.Video ? 'mp4' : 'jpg'}`, data });
      }
      if (entries.length === 0) return;

      await ctx.replyWithDocument(
        { source: createZip(entries), filename: `${name}.zip` },
        { caption: this.caption(ctx, `${entries.length} files`) },
      );
    });
  }

  /* -------------------------------- Users -------------------------------- */

  private renderUsers(page: UsersPage): string {
    if (page.total === 0) return 'No users yet.';
    const offset: number = (page.page - 1) * USERS_PAGE_SIZE;
    const lines: string[] = page.users.map((user: UsersPage['users'][number], i: number): string => {
      const name: string = escapeHtml(user.full_name ?? user.username ?? user.uid);
      const username: string = user.username !== null ? ` - @${escapeHtml(user.username)}` : '';
      return `${offset + i + 1}. <a href="tg://user?id=${user.uid}">${name}</a>${username}`;
    });
    return `<b>Users</b> (${page.total}) - page ${page.page}/${page.totalPages}\n\n${lines.join('\n')}`;
  }

  private usersKeyboard(page: UsersPage): ReturnType<typeof Markup.inlineKeyboard> {
    const row: InlineKeyboardButton[] = [];
    if (page.page > 1) row.push(Markup.button.callback('« Prev', `users:${page.page - 1}`));
    row.push(Markup.button.callback(`${page.page}/${page.totalPages}`, 'noop'));
    if (page.page < page.totalPages) row.push(Markup.button.callback('Next »', `users:${page.page + 1}`));
    return Markup.inlineKeyboard([row]);
  }

  /* -------------------------------- Errors ------------------------------- */

  private async safely(ctx: BotContext, task: () => Promise<void>): Promise<void> {
    try {
      await task();
    } catch (err: unknown) {
      this.logger.error('Instagram request failed', err instanceof Error ? err.stack : String(err));
      await ctx.reply(this.describeError(err)).catch((): void => undefined);
    }
  }

  private describeError(err: unknown): string {
    if (err instanceof InstagramError) {
      if (err.status === 404) return '❌ Not found. The account may be private or the link is wrong.';
      if (err.status === 401 || err.status === 403) return '❌ Instagram rejected the request (session expired?).';
      if (err.status === 429) return '⏳ Instagram rate limit hit. Try again later.';
    }
    return '❌ Something went wrong while fetching the media.';
  }
}
