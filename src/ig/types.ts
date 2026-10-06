export enum MediaType {
  Photo = 'photo',
  Video = 'video',
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

export interface IgScrapedInfo {
  pk: string | null;
  username: string | null;
  id: string | null;
  raw?: any;
}
