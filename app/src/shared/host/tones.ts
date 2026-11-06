// TONE3000 (OAuth 2.0 + PKCE, bounded lists, model downloads) and the links between tones and pedal slots. Owner: Tones.
// Main process: src/main/ipc/tones.ts (+ src/main/tone3000/*). Tokens never leave main.
// API reference: https://www.tone3000.com/api (v1). Free tier: Select/Load Tone flows + created/favorited/downloaded/trending/latest only.

import type { DeviceKey } from "../devices";

export type T3kGear = "amp" | "amp-cab" | "pedal" | "outboard" | "cab" | "space" | "experimental";
export type T3kFormat = "nam" | "ir" | "aida-x" | "aa-snapshot" | "proteus";
export type T3kSize = "standard" | "lite" | "feather" | "nano" | "custom";
/** "1" = A1, "2" = A2, "custom"; null for non-NAM models (IRs). */
export type T3kArchitecture = "1" | "2" | "custom";

export interface T3kUser {
  id: number;
  username: string;
  /** Only set for verified creators; fall back to username. */
  display_name: string | null;
  avatar_url: string | null;
  url: string;
}

export interface T3kTone {
  id: number;
  title: string;
  description: string | null;
  gear: T3kGear;
  images: string[] | null;
  format: T3kFormat;
  license: string;
  /** Missing on some search results. */
  sizes?: T3kSize[] | null;
  makes: { id: number; name: string }[];
  models_count: number;
  a1_models_count: number;
  a2_models_count: number;
  custom_models_count: number;
  irs_count: number;
  downloads_count: number;
  favorites_count: number;
  is_public: boolean | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  url: string;
  user: T3kUser;
}

export interface T3kModel {
  id: number;
  name: string;
  size: T3kSize;
  tone_id: number;
  architecture_version: T3kArchitecture | null;
  model_url: string;
  updated_at: string;
}

export type ToneListKind = "favorited" | "created" | "downloaded" | "trending" | "latest";

export type ToneSort = "best-match" | "newest" | "oldest" | "trending" | "downloads-all-time";

/** `GET /tones/search` filters (`TonesApi.search`). Empty `query` browses by `sort` alone. */
export interface ToneSearchParams {
  query: string;
  sort: ToneSort;
  gears: T3kGear[];
  format: "nam" | "ir" | null;
  architecture: T3kArchitecture | null;
}

export interface TonePage {
  tones: T3kTone[];
  page: number;
  totalPages: number;
  /** Total items in the list (trending/latest: the number returned) */
  total: number;
  /** When this page was fetched from TONE3000 (ms); older than now = served from the 10-minute cache */
  fetchedAt: number;
}

export interface AccountState {
  /** "expired": the refresh token was rejected; the user must sign in again */
  status: "signed-out" | "signed-in" | "expired";
  user: T3kUser | null;
  /** A TONE3000 publishable key (client_id) is in effect: the one from Settings, else the build's */
  configured: boolean;
  /** Key entered in Settings; null when the build's key (or none) is used */
  appKey: string | null;
  /** The partnership splash has been shown and continued once */
  splashSeen: boolean;
  /** Linux without a keyring: tokens are not kept on disk, so the user stays signed in only for this run */
  insecureStorage: boolean;
}

/** Authorize-URL options for the embedded flow. */
export interface FlowRequest {
  prompt?: "select_tone" | "load_tone";
  /** Required for load_tone */
  toneId?: number;
  format?: "nam" | "ir";
  /** Underscore-separated gear list, e.g. "amp_amp-cab_pedal" */
  gears?: string;
  architecture?: "1" | "2" | "custom";
}

/** Where the TONE3000 view goes, in CSS pixels relative to the window content. */
export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type FlowResult =
  | { status: "connected"; user: T3kUser | null; toneId: number | null }
  | { status: "canceled" }
  | { status: "error"; message: string };

/** Verdict of a local NAM file check (send step 2). */
export interface NamCheck {
  /** Version found in the downloaded file, e.g. "0.5.4" or "0.7.0" */
  version: string;
  /** The A1 file was converted from 0.7.x to the 0.5.x layout (A2 files are never changed) */
  reshaped: boolean;
  /** NAM architecture family Tone Studio renders the SnapTone from */
  arch: "A1" | "A2";
  /** A1: standard, lite, feather or nano; A2: the rendered (last) submodel, standard (8 channels) or nano (3) */
  size: string;
}

export interface SendRequest {
  toneId: number;
  modelId: number;
  /** Pedal name, at most 10 characters */
  name: string;
  /**
   * An edited .nam (capture editor) to convert instead of the downloaded file. The model is still downloaded
   * once so the tone record lists it.
   */
  text?: string;
}

/** A downloaded, checked WAV IR, for the in-app User IR converter (renderer/src/userir/convert.ts). */
export interface UserIrSource {
  /** The WAV file as downloaded from TONE3000 */
  wav: Uint8Array;
  record: ToneRecord;
}

/** A checked NAM model (A1 or A2) ready for the in-app SnapTone converter. */
export interface SnapToneSource {
  /** The model as shared/nam.ts prepareNam returns it: A1 in the 0.5.x JSON layout, A2 unchanged */
  text: string;
  /** Bytes downloaded from TONE3000 */
  bytes: number;
  check: NamCheck;
  record: ToneRecord;
}

export type SendStep = "download" | "check";

export type TonesEvent = { type: "progress"; toneId: number; modelId: number; step: SendStep; received: number; total: number | null };

/** A tone linked to a pedal slot (`TonesApi.link`). */
export interface SlotLink {
  kind: "snaptone" | "ir";
  slot: number;
  slotName: string;
  /** Pedal the slot is on (the connected one when the link is made) */
  device: DeviceKey;
}

/** Local tone record, `tones/<tone_id>/meta.json`. */
export interface ToneRecord {
  tone_id: number;
  title: string;
  gear: T3kGear;
  format: T3kFormat;
  creator: { username: string; avatar_url: string | null };
  image_url: string | null;
  license: string;
  url: string;
  models: { id: number; name: string; size: T3kSize; architecture: T3kArchitecture | null; file: string; bytes: number }[];
  /** Pedal compatibility and slot link. The field keeps its pre-GP-50 name so older meta.json files load. */
  gp5: {
    verdict: "ready" | "reshape" | "not-loadable" | "ir";
    snaptoneSlot?: number;
    irSlot?: number;
    /** Slot name at link time, re-confirmed on each slot read */
    slotName?: string;
    linkedAt?: string;
    /** Pedal model the slot link is on; absent in records linked before GP-50 support, which are GP-5 links */
    device?: DeviceKey;
  };
  savedAt: string;
}

export interface TonesApi {
  account(): Promise<AccountState>;
  markSplashSeen(): Promise<void>;
  /** Run a TONE3000 flow in the embedded view; resolves when it ends (redirect, cancel or error). */
  beginFlow(req: FlowRequest, bounds: ViewBounds): Promise<FlowResult>;
  setFlowBounds(bounds: ViewBounds): Promise<void>;
  cancelFlow(): Promise<void>;
  signOut(): Promise<void>;
  /** Save the app key from Settings (null or empty: use the build's). A different effective key signs out. */
  setAppKey(appKey: string | null): Promise<AccountState>;

  /** Bounded list (cached 10 minutes unless `refresh`). Pages are 20 tones; trending/latest have one page. */
  list(kind: ToneListKind, page: number, refresh?: boolean): Promise<TonePage>;
  /**
   * Search TONE3000 (25 per page, cached 10 minutes unless `refresh`). Heavily rate-limited upstream and possibly
   * not allowed for the app's key: rejects with `unsupported` (403) or `network` (429); the UI then offers the Select flow.
   */
  search(params: ToneSearchParams, page: number, refresh?: boolean): Promise<TonePage>;
  tone(id: number): Promise<T3kTone>;
  /** All models of a tone, A1 + A2 + custom */
  models(toneId: number): Promise<T3kModel[]>;
  /** Cached image as a data: URL (null when it can't be fetched) */
  image(url: string): Promise<string | null>;

  /** Download a model to `tones/<toneId>/` (Bearer, streamed; progress via onEvent) and record it in meta.json. */
  downloadModel(toneId: number, modelId: number): Promise<{ path: string; bytes: number; record: ToneRecord }>;
  /** IR send steps 1–2: download and check it is a WAV; returns the file for the in-app converter. */
  prepareIr(req: SendRequest): Promise<UserIrSource>;
  /** SnapTone send steps 1–2: download and check (+ reshape); returns the model for the in-app converter. */
  prepareSnapTone(req: SendRequest): Promise<SnapToneSource>;
  /** Bytes of a .wav opened from the OS by path (no TONE3000 link). Desktop only. */
  readLocalIr(path: string): Promise<Uint8Array>;
  /** Text of a .nam opened from the OS by path, for a SnapTone (no TONE3000 link). Desktop only. */
  readLocalNam(path: string): Promise<string>;
  /**
   * Asks the user for a .nam ("nam") or a .wav ("ir") on this computer. Resolves with its path and name, or null when the dialog is
   * cancelled. Desktop only.
   */
  chooseLocalFile(kind: "nam" | "ir"): Promise<{ path: string; name: string } | null>;
  /** Bytes of a downloaded IR tone's WAV (no download, no record change); not-found when nothing is on disk. */
  readIr(toneId: number): Promise<Uint8Array>;
  /** Text of a downloaded NAM model as stored (no download, no record change, not reshaped); not-found when it isn't on disk. */
  readNam(toneId: number, modelId: number): Promise<string>;
  /** Link a tone to a pedal slot (null unlinks). Local metadata only; nothing is written to the pedal. */
  link(toneId: number, link: SlotLink | null): Promise<ToneRecord>;
  /** Every local tone record */
  local(): Promise<ToneRecord[]>;
  /** Progress of the download and check steps */
  onEvent(cb: (event: TonesEvent) => void): () => void;
}
