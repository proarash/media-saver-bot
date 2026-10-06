import puppeteer, { Browser } from 'puppeteer';
import { AppDataSource } from './db';
import { User, Admin, BotSettings, BOT_SETTINGS_ID } from './entities';
import { Highlight, IgScrapedInfo, InstagramTarget, MediaFile, MediaType, Profile } from './types';

const API_BASE = 'https://i.instagram.com/api/v1';
const WEB_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const APP_HEADERS: Readonly<Record<string, string>> = {
  'User-Agent':
    'Instagram 361.0.0.35.82 (iPad13,8; iOS 18_0; en_US; en-US; scale=2.00; 2048x2732; 674117118) AppleWebKit/420+',
  'x-ig-app-id': '124024574287414',
  'x-ads-opt-out': '1',
  'x-ig-connection-type': 'WiFi',
  'x-ig-capabilities': '36r/F/8=',
};

const WEB_HEADERS: Readonly<Record<string, string>> = {
  'User-Agent': WEB_USER_AGENT,
  'x-ig-app-id': '936619743392459',
  'x-requested-with': 'XMLHttpRequest',
};

const SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const POST_RE = /instagram\.com\/(?:[A-Za-z0-9._]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i;
const HIGHLIGHT_RE = /instagram\.com\/stories\/highlights\/(\d+)/i;
const PROFILE_URL_RE = /instagram\.com\/([A-Za-z0-9._]{1,30})\/?(?:[?#].*)?$/i;
const USERNAME_RE = /^@?([A-Za-z0-9._]{1,30})$/;
const RESERVED_PATHS: ReadonlySet<string> = new Set(['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct']);

export function shortcodeToMediaId(shortcode: string): string {
  const code = shortcode.length > 11 ? shortcode.slice(0, 11) : shortcode;
  let id = 0n;
  for (const char of code) {
    const index = SHORTCODE_ALPHABET.indexOf(char);
    if (index < 0) throw new Error(`Invalid shortcode: ${shortcode}`);
    id = id * 64n + BigInt(index);
  }
  return id.toString();
}

export function parseTarget(input: string): InstagramTarget | null {
  const text = input.trim();
  const highlight = HIGHLIGHT_RE.exec(text);
  if (highlight?.[1] !== undefined) return { type: 'highlight', id: highlight[1] };

  const post = POST_RE.exec(text);
  if (post?.[1] !== undefined) return { type: 'post', shortcode: post[1] };

  const profile = PROFILE_URL_RE.exec(text) ?? USERNAME_RE.exec(text);
  const username = profile?.[1];
  if (username !== undefined && !RESERVED_PATHS.has(username.toLowerCase())) {
    return { type: 'profile', username };
  }
  return null;
}

function largest(candidates: any[] | undefined): any | undefined {
  if (!candidates || candidates.length === 0) return undefined;
  return candidates.reduce((best: any, c: any) =>
    c.width * c.height > best.width * best.height ? c : best,
  );
}

export function extractMedia(item: any): MediaFile[] {
  if (item.carousel_media && item.carousel_media.length > 0) {
    return item.carousel_media.flatMap(extractMedia);
  }
  const video = largest(item.video_versions);
  if (video) return [{ type: MediaType.Video, url: video.url }];
  const image = largest(item.image_versions2?.candidates);
  if (image) return [{ type: MediaType.Photo, url: image.url }];
  return [];
}

export class InstagramService {
  private cookieHeader: string = '';
  private browser: Browser | null = null;

  constructor() {
    this.refreshCookies();
  }

  public refreshCookies(): void {
    const cookies: Record<string, string> = {
      csrftoken: process.env.IG_CSRF_TOKEN || '',
      lsd: process.env.IG_LSD || '',
      datr: process.env.IG_DATR || '',
      did: process.env.IG_DID || '',
      mid: process.env.IG_MID || '',
      ds_user_id: process.env.IG_DS_USER_ID || '',
      sessionid: process.env.IG_SESSION_ID || '',
      rur: process.env.IG_RUR || '',
    };
    this.cookieHeader = Object.entries(cookies)
      .filter(([_, v]) => Boolean(v))
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  private async request<T>(path: string, client: 'app' | 'web' = 'app'): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: {
        ...(client === 'app' ? APP_HEADERS : WEB_HEADERS),
        Cookie: this.cookieHeader,
        'x-csrftoken': process.env.IG_CSRF_TOKEN || '',
        'x-fb-lsd': process.env.IG_LSD || '',
        Accept: '*/*',
      },
    });
    if (!res.ok) {
      throw new Error(`Instagram responded with ${res.status} for ${path}`);
    }
    return (await res.json()) as T;
  }

  public async getPostMedia(shortcode: string): Promise<MediaFile[]> {
    const data = await this.request<any>(`/media/${shortcodeToMediaId(shortcode)}/info/`);
    const item = data.items?.[0];
    if (!item) throw new Error('Post not found');
    return extractMedia(item);
  }

  public async getProfile(username: string): Promise<Profile> {
    const name = encodeURIComponent(username);
    let user: any;

    try {
      const info = await this.request<any>(`/users/${name}/usernameinfo/`);
      user = info.user;
    } catch {
      try {
        const feed = await this.request<any>(`/feed/user/${name}/username/?count=1`, 'web');
        user = feed.user ?? feed.items?.[0]?.user;
      } catch {
        const web = await this.request<any>(`/users/web_profile_info/?username=${name}`, 'web');
        const webUser = web.data?.user;
        if (webUser) {
          user = {
            pk_id: webUser.id,
            username: webUser.username,
            full_name: webUser.full_name,
            profile_pic_url: webUser.profile_pic_url_hd ?? webUser.profile_pic_url,
          };
        }
      }
    }

    if (!user) {
      // Fallback: scrape profile using Puppeteer
      const scraped = await this.scrapeInstagramUser(username);
      if (scraped.id || scraped.pk) {
        return {
          id: scraped.id || scraped.pk || '',
          username: scraped.username || username,
          fullName: null,
          hdProfilePicUrl: '',
        };
      }
      throw new Error(`Profile not found for ${username}`);
    }

    const id = String(user.pk_id ?? user.pk);
    const hdUrl =
      user.hd_profile_pic_url_info?.url ??
      user.hd_profile_pic_versions?.at(-1)?.url ??
      user.profile_pic_url ??
      '';

    return {
      id,
      username: user.username ?? username,
      fullName: user.full_name || null,
      hdProfilePicUrl: hdUrl,
    };
  }

  public async getHighlights(userId: string): Promise<Highlight[]> {
    const data = await this.request<any>(`/highlights/${userId}/highlights_tray/`);
    return (data.tray ?? []).map((reel: any) => ({
      id: String(reel.id).replace(/^highlight:/, ''),
      title: reel.title ?? '',
    }));
  }

  public async getHighlightMedia(highlightId: string): Promise<MediaFile[]> {
    const reelId = `highlight:${highlightId}`;
    const data = await this.request<any>(`/feed/reels_media/?reel_ids=${encodeURIComponent(reelId)}`);
    const items = data.reels?.[reelId]?.items ?? data.reels_media?.[0]?.items ?? [];
    return items.flatMap(extractMedia);
  }

  public async fetchBuffer(url: string): Promise<Buffer> {
    const res = await fetch(url, { headers: { 'User-Agent': WEB_USER_AGENT } });
    if (!res.ok) throw new Error(`CDN error: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  /**
   * New service: Puppeteer scraping service to request https://instagram.com/<USERNAME>
   * retrieves the source code and extracts pk, username, and id.
   */
  public async scrapeInstagramUser(username: string): Promise<IgScrapedInfo> {
    const cleanUser = username.replace(/^@/, '').trim();
    const url = `https://instagram.com/${encodeURIComponent(cleanUser)}/`;

    let browser: Browser | null = null;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
        ],
      });

      const page = await browser.newPage();
      await page.setUserAgent(WEB_USER_AGENT);
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
      });

      // Pass existing cookies to page if configured
      if (process.env.IG_SESSION_ID) {
        const cookiesToSet = [
          { name: 'sessionid', value: process.env.IG_SESSION_ID, domain: '.instagram.com' },
          ...(process.env.IG_DS_USER_ID ? [{ name: 'ds_user_id', value: process.env.IG_DS_USER_ID, domain: '.instagram.com' }] : []),
          ...(process.env.IG_CSRF_TOKEN ? [{ name: 'csrftoken', value: process.env.IG_CSRF_TOKEN, domain: '.instagram.com' }] : []),
          ...(process.env.IG_MID ? [{ name: 'mid', value: process.env.IG_MID, domain: '.instagram.com' }] : []),
        ];
        await page.setCookie(...cookiesToSet);
      }

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const html = await page.content();

      return this.extractUserFromHtml(html, cleanUser);
    } catch (err) {
      console.error(`Puppeteer scraping error for ${cleanUser}:`, (err as Error).message);
      // Fallback direct HTTP fetch attempt
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': WEB_USER_AGENT,
            Cookie: this.cookieHeader,
          },
        });
        const html = await res.text();
        return this.extractUserFromHtml(html, cleanUser);
      } catch (fetchErr) {
        throw new Error(`Failed to scrape Instagram user ${cleanUser}: ${(err as Error).message}`);
      }
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }

  private extractUserFromHtml(html: string, targetUsername: string): IgScrapedInfo {
    let pk: string | null = null;
    let username: string | null = null;
    let id: string | null = null;

    // Pattern 1: Regex searches inside HTML / JSON scripts
    const userMatch = html.match(/"username":\s*"([^"]+)"/);
    if (userMatch && userMatch[1]) {
      username = userMatch[1];
    } else {
      username = targetUsername;
    }

    const pkMatch = html.match(/"pk":\s*"?([0-9]+)"?/);
    if (pkMatch && pkMatch[1]) {
      pk = pkMatch[1];
    }

    const idMatch = html.match(/"id":\s*"?([0-9]+)"?/);
    if (idMatch && idMatch[1]) {
      id = idMatch[1];
    }

    // Try finding "user_id":"12345" or "owner":{"id":"12345"}
    if (!id || !pk) {
      const ownerIdMatch = html.match(/"user_id":\s*"?([0-9]+)"?/) || html.match(/"profilePage_([0-9]+)"/);
      if (ownerIdMatch && ownerIdMatch[1]) {
        id = id || ownerIdMatch[1];
        pk = pk || ownerIdMatch[1];
      }
    }

    // If pk was found but not id, or vice versa (Instagram's pk is identical to numeric id)
    if (pk && !id) id = pk;
    if (id && !pk) pk = id;

    return {
      pk,
      username: username || targetUsername,
      id,
    };
  }
}

export class TelegramService {
  private settingsCache: BotSettings | null = null;

  private isDbAvailable(): boolean {
    return AppDataSource.isInitialized;
  }

  public toPayload(from: any): any {
    const fullName = [from.first_name, from.last_name].filter(Boolean).join(' ');
    return {
      uid: String(from.id),
      full_name: fullName === '' ? null : fullName,
      username: from.username ?? null,
      lang: from.language_code ?? null,
    };
  }

  public async upsertUser(payload: any): Promise<void> {
    if (!this.isDbAvailable()) return;
    try {
      const repo = AppDataSource.getRepository(User);
      let user = await repo.findOneBy({ uid: payload.uid });
      if (!user) user = repo.create({ uid: payload.uid });
      user.full_name = payload.full_name;
      user.username = payload.username;
      user.lang = payload.lang;
      await repo.save(user);
    } catch (err) {
      console.warn('upsertUser failed:', (err as Error).message);
    }
  }

  public async setPhoneNumber(uid: string, phoneNumber: string): Promise<void> {
    if (!this.isDbAvailable()) return;
    try {
      await AppDataSource.getRepository(User).update({ uid }, { phone_number: phoneNumber });
    } catch (err) {
      console.warn('setPhoneNumber failed:', (err as Error).message);
    }
  }

  public async isAdmin(uid: string): Promise<boolean> {
    const adminsList = (process.env.ADMINS_LIST || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (adminsList.includes(uid)) return true;

    if (!this.isDbAvailable()) return false;
    try {
      return await AppDataSource.getRepository(Admin).existsBy({ uid });
    } catch {
      return false;
    }
  }

  public async getAdminUids(): Promise<string[]> {
    const adminsList = (process.env.ADMINS_LIST || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!this.isDbAvailable()) return adminsList;
    try {
      const dbAdmins = await AppDataSource.getRepository(Admin).find({ select: { uid: true } });
      const dbUids = dbAdmins.map((a) => a.uid);
      return Array.from(new Set([...adminsList, ...dbUids]));
    } catch {
      return adminsList;
    }
  }

  public async listUsers(page: number, pageSize: number): Promise<{ users: User[]; page: number; totalPages: number; total: number }> {
    if (!this.isDbAvailable()) {
      return { users: [], page: 1, totalPages: 1, total: 0 };
    }
    const repo = AppDataSource.getRepository(User);
    const total = await repo.count();
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const current = Math.min(Math.max(1, page), totalPages);
    const users = await repo.find({
      select: { uid: true, full_name: true, username: true },
      order: { id: 'ASC' },
      skip: (current - 1) * pageSize,
      take: pageSize,
    });
    return { users, page: current, totalPages, total };
  }

  public async getSettings(): Promise<BotSettings> {
    if (this.settingsCache !== null) return this.settingsCache;
    if (!this.isDbAvailable()) {
      return { id: BOT_SETTINGS_ID, disabled: false, forward_enabled: false, updated_at: new Date() } as BotSettings;
    }
    const repo = AppDataSource.getRepository(BotSettings);
    const existing = await repo.findOneBy({ id: BOT_SETTINGS_ID });
    if (existing) {
      this.settingsCache = existing;
      return existing;
    }
    const created = repo.create({ id: BOT_SETTINGS_ID, disabled: false, forward_enabled: false });
    this.settingsCache = await repo.save(created);
    return this.settingsCache;
  }

  public async toggleDisabled(): Promise<BotSettings> {
    const settings = await this.getSettings();
    settings.disabled = !settings.disabled;
    if (this.isDbAvailable()) {
      this.settingsCache = await AppDataSource.getRepository(BotSettings).save(settings);
    }
    return settings;
  }

  public async toggleForward(): Promise<BotSettings> {
    const settings = await this.getSettings();
    settings.forward_enabled = !settings.forward_enabled;
    if (this.isDbAvailable()) {
      this.settingsCache = await AppDataSource.getRepository(BotSettings).save(settings);
    }
    return settings;
  }
}
