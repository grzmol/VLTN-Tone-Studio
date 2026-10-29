// TONE3000 REST client (v1). Endpoints and parameters per https://www.tone3000.com/api.
import { HostError } from "@shared/ipc";
import type { T3kGear, T3kModel, T3kTone, T3kUser, ToneListKind, ToneSearchParams, ToneSort } from "@shared/host/tones";
import { InvalidGrantError, type TokenManager, type TokenResponse } from "./tokens";

export const T3K_ORIGIN = "https://www.tone3000.com";
export const PAGE_SIZE = 20;
export const SEARCH_PAGE_SIZE = 25;

const GEARS: readonly T3kGear[] = ["amp", "amp-cab", "pedal", "outboard", "cab", "space", "experimental"];
const SORTS: readonly ToneSort[] = ["best-match", "newest", "oldest", "trending", "downloads-all-time"];

/** Renderer input is untrusted: keep only known values and a bounded query. */
export function normalizeSearch(raw: unknown): ToneSearchParams {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | null => (allowed.includes(v as T) ? (v as T) : null);
  return {
    query: typeof r.query === "string" ? r.query.trim().slice(0, 100) : "",
    sort: pick(r.sort, SORTS) ?? "best-match",
    gears: Array.isArray(r.gears) ? GEARS.filter((g) => (r.gears as unknown[]).includes(g)) : [],
    format: pick(r.format, ["nam", "ir"] as const),
    architecture: pick(r.architecture, ["1", "2", "custom"] as const),
  };
}

export function searchPath(p: ToneSearchParams, page: number): string {
  const q = new URLSearchParams({ page: String(page), page_size: String(SEARCH_PAGE_SIZE), sort: p.sort });
  if (p.query) q.set("query", p.query);
  if (p.gears.length) q.set("gears", p.gears.join("_"));
  if (p.format) q.set("format", p.format);
  if (p.architecture) q.set("architecture", p.architecture);
  return `/tones/search?${q}`;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** True for https URLs on tone3000.com or one of its subdomains. Only these hosts may receive the access token. */
export function isT3kUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && (hostname === "tone3000.com" || hostname.endsWith(".tone3000.com"));
  } catch {
    return false;
  }
}

/**
 * Copy of `headers` without any Authorization header (any letter case) unless `url` is a TONE3000 URL.
 * Electron's webRequest hook calls this for every hop of a request, so a redirect to another host drops the token.
 */
export function withoutForeignAuthorization(url: string, headers: Record<string, string>): Record<string, string> {
  if (isT3kUrl(url)) return { ...headers };
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) if (name.toLowerCase() !== "authorization") out[name] = value;
  return out;
}

function assertHttps(url: string): void {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    throw new HostError("invalid", "TONE3000 sent a link that isn't a valid URL.");
  }
  if (protocol !== "https:") throw new HostError("invalid", "TONE3000 sent a link that isn't https.");
}

interface Paginated<T> {
  data: T[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

function networkError(e: unknown): HostError {
  if (e instanceof HostError) return e;
  return new HostError("network", "Can't reach TONE3000. Check your connection and try again.");
}

async function failure(res: Response, forbidden?: HostError): Promise<HostError> {
  if (res.status === 429) {
    const after = Number(res.headers.get("retry-after"));
    return new HostError("network", `TONE3000 asks us to slow down. Try again in ${Number.isFinite(after) && after > 0 ? Math.ceil(after) : 60} s.`);
  }
  if (res.status === 401) return new HostError("unauthorized", "Your TONE3000 sign-in expired. Sign in again.");
  if (res.status === 403) return forbidden ?? new HostError("unauthorized", "TONE3000 doesn't allow this tone for your account.");
  if (res.status === 404) return new HostError("not-found", "This tone isn't on TONE3000 anymore, or it's private.");
  return new HostError("network", `TONE3000 answered ${res.status}. Try again in a moment.`);
}

/** POST /api/v1/oauth/token (form-encoded). Maps 400 invalid_grant to InvalidGrantError. */
export async function postToken(fetchFn: FetchLike, params: Record<string, string>): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetchFn(`${T3K_ORIGIN}/api/v1/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
  } catch (e) {
    throw networkError(e);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 400 && body.error === "invalid_grant") throw new InvalidGrantError();
    throw new HostError(res.status === 429 ? "network" : "unauthorized", body.error ? `TONE3000 sign-in failed (${body.error})` : `TONE3000 sign-in failed (${res.status})`);
  }
  return (await res.json()) as TokenResponse;
}

export class T3kClient {
  constructor(
    private tokens: TokenManager,
    private fetchFn: FetchLike,
  ) {}

  /**
   * Request an https URL. Only a TONE3000 URL gets the access token, and only a TONE3000 response
   * gets the one refresh-and-retry on 401. The fetch follows redirects; the session strips the token
   * from any hop to another host (see `withoutForeignAuthorization`). A response that ends on a
   * non-https URL is refused.
   */
  async request(url: string, init: RequestInit = {}, forbidden?: HostError): Promise<Response> {
    assertHttps(url);
    const token = isT3kUrl(url) ? await this.tokens.accessToken() : null;
    let res = await this.send(url, init, token);
    // res.url is the final URL after redirects; it is empty for a response built by hand.
    const finalUrl = res.url || url;
    if (res.url && new URL(res.url).protocol !== "https:") throw new HostError("invalid", "TONE3000 sent a download that isn't https.");
    if (token && res.status === 401 && isT3kUrl(finalUrl)) res = await this.send(url, init, await this.tokens.forceRefresh());
    if (!res.ok) {
      if (!isT3kUrl(finalUrl) && (res.status === 401 || res.status === 403))
        throw new HostError("network", "The download link from TONE3000 was refused. Try again in a moment.");
      throw await failure(res, forbidden);
    }
    return res;
  }

  /** Fetch a model file. Same rules as `request`: the token goes only to TONE3000 hosts. */
  download(url: string): Promise<Response> {
    return this.request(url);
  }

  private async send(url: string, init: RequestInit, token: string | null): Promise<Response> {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      return await this.fetchFn(url, { ...init, headers });
    } catch (e) {
      throw networkError(e);
    }
  }

  private async json<T>(path: string, forbidden?: HostError): Promise<T> {
    const res = await this.request(`${T3K_ORIGIN}/api/v1${path}`, { headers: { "Content-Type": "application/json" } }, forbidden);
    return (await res.json()) as T;
  }

  user(): Promise<T3kUser> {
    return this.json<T3kUser>("/user");
  }

  async list(kind: ToneListKind, page: number): Promise<{ tones: T3kTone[]; page: number; totalPages: number; total: number }> {
    if (kind === "trending" || kind === "latest") {
      const { data } = await this.json<{ data: T3kTone[] }>(`/tones/${kind}`);
      return { tones: data, page: 1, totalPages: 1, total: data.length };
    }
    const res = await this.json<Paginated<T3kTone>>(`/tones/${kind}?page=${page}&page_size=${PAGE_SIZE}`);
    return { tones: res.data, page: res.page, totalPages: res.total_pages, total: res.total };
  }

  async search(params: ToneSearchParams, page: number): Promise<{ tones: T3kTone[]; page: number; totalPages: number; total: number }> {
    const res = await this.json<Paginated<T3kTone>>(searchPath(params, page), new HostError("unsupported", "TONE3000 doesn't allow search for this app key."));
    return { tones: res.data, page: res.page, totalPages: res.total_pages, total: res.total };
  }

  tone(id: number): Promise<T3kTone> {
    return this.json<T3kTone>(`/tones/${id}`);
  }

  /** All architectures: A1 and custom are the default; A2 needs architecture=2 (fetched separately). */
  async models(toneId: number): Promise<T3kModel[]> {
    const all = async (arch: string | null) => {
      const out: T3kModel[] = [];
      for (let page = 1; ; page++) {
        const res = await this.json<Paginated<T3kModel>>(`/models?tone_id=${toneId}&page=${page}&page_size=100${arch ? `&architecture=${arch}` : ""}`);
        out.push(...res.data);
        if (page >= res.total_pages || res.data.length === 0) return out;
      }
    };
    const [legacy, a2] = await Promise.all([all(null), all("2")]);
    const seen = new Set(legacy.map((m) => m.id));
    return [...legacy, ...a2.filter((m) => !seen.has(m.id))];
  }
}
