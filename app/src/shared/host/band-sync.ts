// The band sync host API (spec 44): the leader's settings for the local network sync, and the transport actions followers ask for.
// Off until the performer starts it. The server listens only on an address from `addresses`, which holds private LAN addresses only.
import type { FollowerAction } from "../band-sync";

/** A local network address the server may listen on. The performer chooses one from the list. */
export interface LanAddress {
  address: string;
  /** The network interface's name, such as en0, shown beside the address. */
  name: string;
}

/** The sync's state, for the settings. The PIN is present only while the server is listening. */
export interface BandSyncStatus {
  listening: boolean;
  /** The address the server listens on, or the one chosen for the next start. */
  address: string | null;
  port: number;
  /** The address followers open, when listening. */
  url: string | null;
  pin: string | null;
  followers: number;
  allowControl: boolean;
  /** The local network addresses the performer can choose from. A public address is never listed. */
  addresses: LanAddress[];
  /** One line for the settings: what is happening, or why it is not. */
  message: string;
}

/** The choice a sync starts with. */
export interface BandSyncOptions {
  address: string;
  port: number;
  allowControl: boolean;
}

export interface BandSyncHostApi {
  status(): Promise<BandSyncStatus>;
  onStatus(callback: (status: BandSyncStatus) => void): () => void;
  /** Starts listening on the chosen address. Off until the performer starts it. */
  start(options: BandSyncOptions): Promise<BandSyncStatus>;
  stop(): Promise<BandSyncStatus>;
  /** A new PIN. Every follower signed in is disconnected and must sign in again. */
  newPin(): Promise<BandSyncStatus>;
  setAllowControl(allowControl: boolean): Promise<BandSyncStatus>;
  /** A transport action a follower asked for, once the performer's app has checked it. */
  onControl(callback: (action: FollowerAction) => void): () => void;
}
