import { MediaType, type IgImageCandidate, type IgMediaItem, type InstagramTarget, type MediaFile } from './instagram.types';

const SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Same conversion instaloader uses (`shortcode_to_mediaid`): url-safe base64 -> integer. */
export function shortcodeToMediaId(shortcode: string): string {
  // Private posts carry a longer shortcode; the media id is encoded in the first 11 chars.
  const code: string = shortcode.length > 11 ? shortcode.slice(0, 11) : shortcode;
  let id: bigint = 0n;
  for (const char of code) {
    const index: number = SHORTCODE_ALPHABET.indexOf(char);
    if (index < 0) throw new Error(`Invalid shortcode: ${shortcode}`);
    id = id * 64n + BigInt(index);
  }
  return id.toString();
}

const POST_RE = /instagram\.com\/(?:[A-Za-z0-9._]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i;
const HIGHLIGHT_RE = /instagram\.com\/stories\/highlights\/(\d+)/i;
const PROFILE_URL_RE = /instagram\.com\/([A-Za-z0-9._]{1,30})\/?(?:[?#].*)?$/i;
const USERNAME_RE = /^@?([A-Za-z0-9._]{1,30})$/;
const RESERVED_PATHS: ReadonlySet<string> = new Set(['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct']);

export function parseTarget(input: string): InstagramTarget | null {
  const text: string = input.trim();

  const highlight: RegExpExecArray | null = HIGHLIGHT_RE.exec(text);
  if (highlight?.[1] !== undefined) return { type: 'highlight', id: highlight[1] };

  const post: RegExpExecArray | null = POST_RE.exec(text);
  if (post?.[1] !== undefined) return { type: 'post', shortcode: post[1] };

  const profile: RegExpExecArray | null = PROFILE_URL_RE.exec(text) ?? USERNAME_RE.exec(text);
  const username: string | undefined = profile?.[1];
  if (username !== undefined && !RESERVED_PATHS.has(username.toLowerCase())) {
    return { type: 'profile', username };
  }
  return null;
}

function largest(candidates: IgImageCandidate[] | undefined): IgImageCandidate | undefined {
  if (candidates === undefined || candidates.length === 0) return undefined;
  return candidates.reduce((best: IgImageCandidate, c: IgImageCandidate): IgImageCandidate =>
    c.width * c.height > best.width * best.height ? c : best,
  );
}

/** Flattens a single image / video / carousel item into best-quality media URLs. */
export function extractMedia(item: IgMediaItem): MediaFile[] {
  if (item.carousel_media !== undefined && item.carousel_media.length > 0) {
    return item.carousel_media.flatMap(extractMedia);
  }
  const video: IgImageCandidate | undefined = largest(item.video_versions);
  if (video !== undefined) return [{ type: MediaType.Video, url: video.url }];
  const image: IgImageCandidate | undefined = largest(item.image_versions2?.candidates);
  if (image !== undefined) return [{ type: MediaType.Photo, url: image.url }];
  return [];
}
