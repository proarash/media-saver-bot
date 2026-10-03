export enum MediaType {
  Photo = 'photo',
  Video = 'video',
  /** Fallback when Telegram rejects a URL as photo/video (size limits, unsupported format). */
  Document = 'document',
}

export interface MediaFile {
  readonly type: MediaType;
  readonly url: string;
}

export interface Highlight {
  readonly id: string;
  readonly title: string;
}

export interface Profile {
  readonly id: string;
  readonly username: string;
  readonly fullName: string | null;
  readonly hdProfilePicUrl: string;
}

export type InstagramTarget =
  | { readonly type: 'post'; readonly shortcode: string }
  | { readonly type: 'highlight'; readonly id: string }
  | { readonly type: 'profile'; readonly username: string };

/* ---- Raw private API (i.instagram.com/api/v1) shapes, only the fields we use ---- */

export interface IgImageCandidate {
  url: string;
  width: number;
  height: number;
}

export interface IgMediaItem {
  pk: string | number;
  /** 1 = image, 2 = video, 8 = carousel */
  media_type: number;
  image_versions2?: { candidates?: IgImageCandidate[] };
  video_versions?: IgImageCandidate[];
  carousel_media?: IgMediaItem[];
}

export interface IgMediaInfoResponse {
  items?: IgMediaItem[];
}

export interface IgWebUser {
  id: string;
  username: string;
  full_name?: string;
  profile_pic_url?: string;
  profile_pic_url_hd?: string;
}

export interface IgWebProfileResponse {
  data?: { user?: IgWebUser | null };
}

export interface IgApiUser {
  pk?: number | string;
  pk_id?: string;
  username?: string;
  full_name?: string;
  profile_pic_url?: string;
  hd_profile_pic_url_info?: { url: string };
  hd_profile_pic_versions?: IgImageCandidate[];
}

export interface IgUserInfoResponse {
  user?: IgApiUser;
}

export interface IgUserFeedResponse {
  user?: IgApiUser;
  items?: { user?: IgApiUser }[];
}

export interface IgHighlightsTrayResponse {
  tray?: { id: string; title?: string }[];
}

export interface IgReelsMediaResponse {
  reels?: Record<string, { items?: IgMediaItem[] }>;
  reels_media?: { items?: IgMediaItem[] }[];
}
