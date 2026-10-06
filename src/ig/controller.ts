import { Request, Response } from 'express';
import { Telegraf, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import { BotCommand, InlineKeyboardButton, Update } from 'telegraf/types';
import { InstagramService, TelegramService, parseTarget } from './service';
import { InstagramTarget, MediaFile, MediaType, Profile } from './types';
import { createZip } from '../common/zip';

const USERS_PAGE_SIZE = 10;
const MEDIA_GROUP_LIMIT = 10;

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
  'Send me any of these and I will reply with the media or profile info:',
  '',
  '• Post link (single image, video or carousel)',
  '• Reel link',
  '• Highlight link (instagram.com/stories/highlights/…)',
  '• Profile link or @username - extracts info (pk, username, id) & profile',
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

export class IgController {
  private bot: Telegraf<any>;
  private instagram: InstagramService;
  private telegram: TelegramService;

  constructor(instagram: InstagramService, telegram: TelegramService) {
    this.instagram = instagram;
    this.telegram = telegram;
    const token = process.env.BOT_TOKEN || '';
    this.bot = new Telegraf(token);
    this.registerBotHandlers();
  }

  public getBot(): Telegraf<any> {
    return this.bot;
  }

  /* ------------------- Express HTTP Endpoints ------------------- */

  // Webhook handler for Telegram
  public handleTelegramWebhook = async (req: Request, res: Response): Promise<void> => {
    const secret = req.headers['x-telegram-bot-api-secret-token'];
    const expectedSecret = process.env.WEBHOOK_SECRET;
    if (expectedSecret && secret !== expectedSecret) {
      res.status(401).send('Invalid webhook secret');
      return;
    }
    try {
      await this.bot.handleUpdate(req.body as Update);
      res.sendStatus(200);
    } catch (err) {
      console.error('Error handling Telegram update:', err);
      res.sendStatus(500);
    }
  };

  // Endpoint to scrape user info: GET /ig/user/:username
  public scrapeUser = async (req: Request, res: Response): Promise<void> => {
    const username = Array.isArray(req.params.username) ? req.params.username[0] : req.params.username;
    if (!username) {
      res.status(400).json({ error: 'Username is required' });
      return;
    }
    try {
      const data = await this.instagram.scrapeInstagramUser(username);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  };

  /* ------------------- Telegram Bot Setup ------------------- */

  private registerBotHandlers(): void {
    // Middleware / Guard
    this.bot.use(async (ctx, next) => {
      ctx.state = ctx.state || {};
      ctx.state.isAdmin = false;
      if (ctx.from === undefined) return next();

      const uid = String(ctx.from.id);
      ctx.state.isAdmin = await this.telegram.isAdmin(uid);

      if (ctx.message && 'text' in ctx.message && /^\/start(?:@\w+)?(?:\s|$)/.test(ctx.message.text)) {
        await this.telegram.upsertUser(this.telegram.toPayload(ctx.from));
      }

      if (ctx.state.isAdmin) return next();

      const settings = await this.telegram.getSettings();
      if (!settings.disabled) return next();

      if (settings.forward_enabled) {
        const admins = await this.telegram.getAdminUids();
        for (const adminUid of admins) {
          await ctx.forwardMessage(adminUid).catch(() => {});
        }
      }
      // Bot disabled for regular users
      return;
    });

    this.bot.command('start', async (ctx) => {
      const help = ctx.state.isAdmin ? `${HELP_TEXT}${ADMIN_HELP_TEXT}` : HELP_TEXT;
      await ctx.reply(`Welcome!\n\n${help}`);
    });

    this.bot.command('help', async (ctx) => {
      const help = ctx.state.isAdmin ? `${HELP_TEXT}${ADMIN_HELP_TEXT}` : HELP_TEXT;
      await ctx.reply(help);
    });

    this.bot.command('highlights', async (ctx) => {
      const args = ctx.message.text.split(/\s+/).slice(1);
      const target = args[0] ? parseTarget(args[0]) : null;
      if (target?.type !== 'profile') {
        await ctx.reply('Usage: /highlights <username>');
        return;
      }
      try {
        const profile = await this.instagram.getProfile(target.username);
        await this.sendHighlightsList(ctx, profile.id);
      } catch (err) {
        await ctx.reply(`Failed to get highlights: ${(err as Error).message}`);
      }
    });

    this.bot.command('zip', async (ctx) => {
      if (!ctx.state.isAdmin) return;
      const args = ctx.message.text.split(/\s+/).slice(1);
      const target = args[0] ? parseTarget(args[0]) : null;
      if (!target) {
        await ctx.reply('Usage: /zip <post link | highlight link | @username>');
        return;
      }
      await this.sendZip(ctx, target);
    });

    this.bot.command('users', async (ctx) => {
      if (!ctx.state.isAdmin) return;
      const page = await this.telegram.listUsers(1, USERS_PAGE_SIZE);
      await ctx.reply(this.renderUsers(page), {
        parse_mode: 'HTML',
        ...this.usersKeyboard(page),
      });
    });

    this.bot.command('disable', async (ctx) => {
      if (!ctx.state.isAdmin) return;
      const s = await this.telegram.toggleDisabled();
      await ctx.reply(`Bot is now ${s.disabled ? 'DISABLED' : 'ENABLED'} for non-admin users.`);
    });

    this.bot.command('forward', async (ctx) => {
      if (!ctx.state.isAdmin) return;
      const s = await this.telegram.toggleForward();
      await ctx.reply(`User message forwarding is now ${s.forward_enabled ? 'ENABLED' : 'DISABLED'}.`);
    });

    this.bot.action(/^users:(\d+)$/, async (ctx) => {
      if (!ctx.state.isAdmin) {
        await ctx.answerCbQuery();
        return;
      }
      const page = await this.telegram.listUsers(Number(ctx.match[1]), USERS_PAGE_SIZE);
      await ctx.answerCbQuery();
      await ctx.editMessageText(this.renderUsers(page), {
        parse_mode: 'HTML',
        ...this.usersKeyboard(page),
      }).catch(() => {});
    });

    this.bot.action('noop', async (ctx) => {
      await ctx.answerCbQuery();
    });

    this.bot.action(/^hls:(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      await this.sendHighlightsList(ctx, ctx.match[1]);
    });

    this.bot.action(/^hl:(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery('Fetching highlight…');
      await this.handleTarget(ctx, { type: 'highlight', id: ctx.match[1] });
    });

    this.bot.action(/^zip:(.+)$/, async (ctx) => {
      if (!ctx.state.isAdmin) {
        await ctx.answerCbQuery('Admins only');
        return;
      }
      const target = decodeTarget(ctx.match[1]);
      await ctx.answerCbQuery(target ? 'Building ZIP…' : 'Invalid request');
      if (target) await this.sendZip(ctx, target);
    });

    this.bot.on(message('contact'), async (ctx) => {
      await this.telegram.setPhoneNumber(String(ctx.from.id), ctx.message.contact.phone_number);
      await ctx.reply('Phone number saved.');
    });

    // Text handling: extract media or scrape username
    this.bot.on(message('text'), async (ctx) => {
      const text = ctx.message.text.trim();
      if (text.startsWith('/')) return;

      // Check if user sent @username directly
      if (/^@?[A-Za-z0-9._]{1,30}$/.test(text) && !text.includes('http')) {
        const username = text.replace(/^@/, '');
        await ctx.sendChatAction('typing').catch(() => {});
        try {
          // Perform scraping
          const scraped = await this.instagram.scrapeInstagramUser(username);
          const responseJson = JSON.stringify(scraped, null, 2);
          
          let replyMsg = `<b>Instagram User Info:</b>\n` +
            `• <b>Username:</b> <code>${escapeHtml(scraped.username || username)}</code>\n` +
            `• <b>PK:</b> <code>${escapeHtml(scraped.pk || 'N/A')}</code>\n` +
            `• <b>ID:</b> <code>${escapeHtml(scraped.id || 'N/A')}</code>\n\n` +
            `<pre><code class="language-json">${escapeHtml(responseJson)}</code></pre>`;

          await ctx.reply(replyMsg, { parse_mode: 'HTML' });
          
          // Also try sending profile photo if possible
          const target: InstagramTarget = { type: 'profile', username };
          await this.handleTarget(ctx, target).catch(() => {});
          return;
        } catch (err) {
          console.error('Scraping error:', err);
        }
      }

      const target = parseTarget(text);
      if (!target) {
        await ctx.reply(HELP_TEXT);
        return;
      }

      await this.handleTarget(ctx, target);
    });
  }

  private async handleTarget(ctx: any, target: InstagramTarget): Promise<void> {
    try {
      await ctx.sendChatAction('upload_photo').catch(() => {});

      if (target.type === 'profile') {
        try {
          const profile = await this.instagram.getProfile(target.username);
          await this.sendProfile(ctx, profile);
        } catch (err) {
          // Fallback if profile media lookup fails
          const scraped = await this.instagram.scrapeInstagramUser(target.username);
          await ctx.reply(JSON.stringify(scraped, null, 2));
        }
        return;
      }

      const files: MediaFile[] =
        target.type === 'post'
          ? await this.instagram.getPostMedia(target.shortcode)
          : await this.instagram.getHighlightMedia(target.id);

      await this.sendMedia(ctx, files);
      if (ctx.state?.isAdmin && files.length > 1) {
        await ctx.reply(
          '📦 Want everything in one file?',
          Markup.inlineKeyboard([Markup.button.callback('Download all as ZIP', `zip:${encodeTarget(target)}`)]),
        );
      }
    } catch (err) {
      await ctx.reply(`Error: ${(err as Error).message}`);
    }
  }

  private async sendProfile(ctx: any, profile: Profile): Promise<void> {
    const title = profile.fullName ? `${profile.fullName} (@${profile.username})` : `@${profile.username}`;
    const buttons: InlineKeyboardButton[][] = [[Markup.button.callback('✨ Highlights', `hls:${profile.id}`)]];
    if (ctx.state?.isAdmin) {
      buttons.push([Markup.button.callback('📦 Everything as ZIP', `zip:u:${profile.username}`)]);
    }
    if (profile.hdProfilePicUrl) {
      await this.sendSingle(ctx, { type: MediaType.Photo, url: profile.hdProfilePicUrl }, this.caption(ctx, title), buttons);
    } else {
      await ctx.reply(title, Markup.inlineKeyboard(buttons));
    }
  }

  private async sendHighlightsList(ctx: any, userId: string): Promise<void> {
    const highlights = await this.instagram.getHighlights(userId);
    if (highlights.length === 0) {
      await ctx.reply('This profile has no highlights.');
      return;
    }
    const buttons = chunk(
      highlights.map((h) => Markup.button.callback(h.title !== '' ? h.title.slice(0, 40) : h.id, `hl:${h.id}`)),
      2,
    );
    await ctx.reply('Choose a highlight:', Markup.inlineKeyboard(buttons));
  }

  private async sendMedia(ctx: any, files: readonly MediaFile[]): Promise<void> {
    if (files.length === 0) {
      await ctx.reply('No media found.');
      return;
    }
    const caption = this.caption(ctx);
    if (files.length === 1 && files[0]) {
      await this.sendSingle(ctx, files[0], caption);
      return;
    }

    for (const group of chunk(files, MEDIA_GROUP_LIMIT)) {
      if (group.length === 1 && group[0]) {
        await this.sendSingle(ctx, group[0], caption);
        continue;
      }
      try {
        await ctx.replyWithMediaGroup(
          group.map((file, index) => ({
            type: file.type === MediaType.Video ? ('video' as const) : ('photo' as const),
            media: file.url,
            ...(index === 0 ? { caption } : {}),
          })),
        );
      } catch {
        for (const file of group) await this.sendSingle(ctx, file, caption);
      }
    }
  }

  private async sendSingle(
    ctx: any,
    file: MediaFile,
    caption: string,
    buttons: InlineKeyboardButton[][] = [],
  ): Promise<void> {
    const extra = { caption, ...(buttons.length > 0 ? Markup.inlineKeyboard(buttons) : {}) };
    try {
      if (file.type === MediaType.Photo) {
        await ctx.replyWithPhoto(file.url, extra);
        return;
      }
      if (file.type === MediaType.Video) {
        await ctx.replyWithVideo(file.url, { ...extra, supports_streaming: true });
        return;
      }
      await ctx.replyWithDocument(file.url, extra);
      return;
    } catch {
      await ctx.reply(`<a href="${escapeHtml(file.url)}">Open media</a>\n\n${escapeHtml(caption)}`, {
        parse_mode: 'HTML',
        ...(buttons.length > 0 ? Markup.inlineKeyboard(buttons) : {}),
      });
    }
  }

  private caption(ctx: any, text?: string): string {
    const signature = ctx.botInfo?.username ? `@${ctx.botInfo.username}` : '';
    return text ? `${text}\n\n${signature}` : signature;
  }

  private async sendZip(ctx: any, target: InstagramTarget): Promise<void> {
    await ctx.reply('Fetching media and building ZIP...');
    try {
      let files: MediaFile[] = [];
      let zipName = 'media.zip';

      if (target.type === 'post') {
        files = await this.instagram.getPostMedia(target.shortcode);
        zipName = `${target.shortcode}.zip`;
      } else if (target.type === 'highlight') {
        files = await this.instagram.getHighlightMedia(target.id);
        zipName = `highlight_${target.id}.zip`;
      } else if (target.type === 'profile') {
        const prof = await this.instagram.getProfile(target.username);
        if (prof.hdProfilePicUrl) {
          files = [{ type: MediaType.Photo, url: prof.hdProfilePicUrl }];
        }
        zipName = `${target.username}.zip`;
      }

      const entries = await Promise.all(
        files.map(async (f, idx) => {
          const ext = f.type === MediaType.Video ? 'mp4' : 'jpg';
          const buffer = await this.instagram.fetchBuffer(f.url);
          return { name: `file_${idx + 1}.${ext}`, data: buffer };
        }),
      );

      const zipBuffer = createZip(entries);
      await ctx.replyWithDocument({ source: zipBuffer, filename: zipName });
    } catch (err) {
      await ctx.reply(`Failed to create ZIP: ${(err as Error).message}`);
    }
  }

  private renderUsers(page: any): string {
    if (page.users.length === 0) return 'No users registered yet.';
    const rows = page.users.map((u: any, i: number) => {
      const num = (page.page - 1) * USERS_PAGE_SIZE + i + 1;
      const tag = u.username ? ` (@${escapeHtml(u.username)})` : '';
      return `${num}. <code>${escapeHtml(u.uid)}</code> ${escapeHtml(u.full_name || 'Anonymous')}${tag}`;
    });
    return `<b>Users (page ${page.page}/${page.totalPages}, total ${page.total}):</b>\n\n${rows.join('\n')}`;
  }

  private usersKeyboard(page: any): any {
    const buttons: InlineKeyboardButton[] = [];
    if (page.page > 1) {
      buttons.push(Markup.button.callback('⬅️ Prev', `users:${page.page - 1}`));
    }
    if (page.page < page.totalPages) {
      buttons.push(Markup.button.callback('Next ➡️', `users:${page.page + 1}`));
    }
    return buttons.length > 0 ? Markup.inlineKeyboard([buttons]) : {};
  }
}
