import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { instagramConfig } from '../../config/instagram.config';
import type {
  Highlight,
  IgApiUser,
  IgUserFeedResponse,
  IgHighlightsTrayResponse,
  IgMediaInfoResponse,
  IgMediaItem,
  IgReelsMediaResponse,
  IgUserInfoResponse,
  IgWebProfileResponse,
  IgWebUser,
  InstagramTarget,
  MediaFile,
  Profile,
} from './instagram.types';
import { extractMedia, parseTarget, shortcodeToMediaId } from './instagram.utils';

const API_BASE = 'https://i.instagram.com/api/v1';

const WEB_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/** Mirrors instaloader's `default_iphone_headers`, needed for the private API endpoints. */
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

type ApiClient = 'app' | 'web';

function userId(user: IgApiUser): string | undefined {
  return user.pk_id ?? (user.pk !== undefined ? String(user.pk) : undefined);
}

function hdPicUrl(user: IgApiUser): string | undefined {
  return user.hd_profile_pic_url_info?.url ?? user.hd_profile_pic_versions?.at(-1)?.url;
}

export class InstagramError extends Error {
  constructor(
    message: string,
    public readonly status: number | null = null,
  ) {
    super(message);
  }
}

/**
 * Resolves Instagram media to direct CDN URLs. Nothing is downloaded to disk;
 * the URLs are handed to Telegram which fetches them itself.
 */
@Injectable()
export class InstagramService {
  private readonly logger: Logger = new Logger(InstagramService.name);
  private readonly cookieHeader: string;

  constructor(@Inject(instagramConfig.KEY) private readonly config: ConfigType<typeof instagramConfig>) {
    this.cookieHeader = Object.entries(config.cookies)
      .map(([key, value]: [string, string]): string => `${key}=${value}`)
      .join('; ');
  }

  public parseTarget(input: string): InstagramTarget | null {
    return parseTarget(input);
  }

  /** Single image, video, reel or carousel. */
  public async getPostMedia(shortcode: string): Promise<MediaFile[]> {
    const data: IgMediaInfoResponse = await this.request(`/media/${shortcodeToMediaId(shortcode)}/info/`);
    const item: IgMediaItem | undefined = data.items?.[0];
    if (item === undefined) throw new InstagramError('Post not found', 404);
    return extractMedia(item);
  }

  /**
   * web_profile_info is gated per account (400/429) since 2026, so the lookup cascades
   * through other username-based endpoints, as instaloader and OpenCLI now do.
   */
  public async getProfile(username: string): Promise<Profile> {
    const name: string = encodeURIComponent(username);
    const resolvers: [string, () => Promise<IgApiUser | undefined>][] = [
      [
        'usernameinfo',
        async (): Promise<IgApiUser | undefined> =>
          (await this.request<IgUserInfoResponse>(`/users/${name}/usernameinfo/`)).user,
      ],
      [
        'feed by username',
        async (): Promise<IgApiUser | undefined> => {
          const feed: IgUserFeedResponse = await this.request(`/feed/user/${name}/username/?count=1`, 'web');
          return feed.user ?? feed.items?.[0]?.user;
        },
      ],
      [
        'web_profile_info',
        async (): Promise<IgApiUser | undefined> => {
          const web: IgWebProfileResponse = await this.request(`/users/web_profile_info/?username=${name}`, 'web');
          const user: IgWebUser | null | undefined = web.data?.user;
          if (user === undefined || user === null) return undefined;
          const picUrl: string | undefined = user.profile_pic_url_hd ?? user.profile_pic_url;
          return {
            pk_id: user.id,
            username: user.username,
            ...(user.full_name !== undefined && { full_name: user.full_name }),
            ...(picUrl !== undefined && { profile_pic_url: picUrl }),
          };
        },
      ],
    ];

    let user: IgApiUser | undefined;
    let lastError: unknown = new InstagramError('Profile not found', 404);
    for (const [label, resolve] of resolvers) {
      try {
        user = await resolve();
        if (user !== undefined && userId(user) !== undefined) break;
        user = undefined;
      } catch (err: unknown) {
        lastError = err;
        this.logger.warn(`${label} lookup failed for ${username}: ${String(err)}`);
      }
    }
    if (user === undefined) throw lastError;
    const id: string = userId(user) as string;

    let hdUrl: string = hdPicUrl(user) ?? user.profile_pic_url ?? '';
    if (hdPicUrl(user) === undefined) {
      try {
        // Same endpoint instaloader uses for the full-resolution profile picture when logged in.
        const info: IgUserInfoResponse = await this.request(`/users/${id}/info/`);
        hdUrl = (info.user !== undefined ? hdPicUrl(info.user) : undefined) ?? hdUrl;
      } catch (err: unknown) {
        this.logger.warn(`HD profile pic lookup failed for ${username}: ${String(err)}`);
      }
    }
    if (hdUrl === '') throw new InstagramError('Profile picture not available');

    return {
      id,
      username: user.username ?? username,
      fullName: user.full_name !== undefined && user.full_name !== '' ? user.full_name : null,
      hdProfilePicUrl: hdUrl,
    };
  }

  public async getHighlights(userId: string): Promise<Highlight[]> {
    const data: IgHighlightsTrayResponse = await this.request(`/highlights/${userId}/highlights_tray/`);
    return (data.tray ?? []).map(
      (reel: { id: string; title?: string }): Highlight => ({
        id: reel.id.replace(/^highlight:/, ''),
        title: reel.title ?? '',
      }),
    );
  }

  public async getHighlightMedia(highlightId: string): Promise<MediaFile[]> {
    const reelId: string = `highlight:${highlightId}`;
    const data: IgReelsMediaResponse = await this.request(`/feed/reels_media/?reel_ids=${encodeURIComponent(reelId)}`);
    const items: IgMediaItem[] = data.reels?.[reelId]?.items ?? data.reels_media?.[0]?.items ?? [];
    return items.flatMap(extractMedia);
  }

  /** Fetches a CDN file into memory (admin ZIP mode only; nothing is written to disk). */
  public async fetchBuffer(url: string): Promise<Buffer> {
    const res: Response = await fetch(url, { headers: { 'User-Agent': WEB_USER_AGENT } });
    if (!res.ok) throw new InstagramError(`CDN responded with ${res.status}`, res.status);
    return Buffer.from(await res.arrayBuffer());
  }

  private async request<T>(path: string, client: ApiClient = 'app'): Promise<T> {
    const res: Response = await fetch(`${API_BASE}${path}`, {
      headers: {
        ...(client === 'app' ? APP_HEADERS : WEB_HEADERS),
        Cookie: this.cookieHeader,
        'x-csrftoken': this.config.csrfToken,
        'x-fb-lsd': this.config.lsd,
        Accept: '*/*',
      },
    });
    if (!res.ok) {
      throw new InstagramError(`Instagram responded with ${res.status} for ${path}`, res.status);
    }
    return (await res.json()) as T;
  }
}
