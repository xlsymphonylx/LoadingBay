// ── Metadata provider pipeline shared types ───────────────────────────────────

export type MetadataSource = "tidal" | "musicbrainz" | "deezer" | "allmusic";

export type MetadataTrack = {
  pos: number;
  title: string;
};

export type MetadataCandidate = {
  source: MetadataSource;
  albumTitle: string;
  artistName: string;
  year: number | null;
  /** Ready-to-display URL. TIDAL uses the /api/discover/cover proxy; Deezer
   *  is a direct CDN URL; MusicBrainz uses Cover Art Archive. */
  coverUrl: string | null;
  tracks: MetadataTrack[];
  /** 0–100 match confidence score (present for MusicBrainz candidates) */
  score?: number;
  // provider-specific IDs — only one set per candidate
  tidalAlbumId?: number;
  mbReleaseId?: string;
  deezerAlbumId?: number;
  allMusicMwid?: string;
};

/**
 * What a provider search-flow component hands back to MetadataProviderModal
 * when the user has selected a result.  apply() is called by MetadataPreview
 * when the user confirms.
 *
 * `applyOptions` lets MetadataPreview offer granular "cover only / tags only"
 * buttons when the provider supports it.
 */
export type ApplyOptions = {
  coverOnly?: boolean;
  tagsOnly?: boolean;
  /** If set, rename artist/album folder(s) to match these names after applying tags. */
  renameArtist?: string;
  renameAlbum?: string;
};

export type ProviderResult = {
  candidates: MetadataCandidate[];
  /**
   * Apply metadata for the candidate at `index`.
   * If options.coverOnly / options.tagsOnly are set, apply only that subset.
   */
  apply: (index: number, options?: ApplyOptions) => Promise<void>;
  /** Called when the user navigates Back from the preview (keeps beets WS alive etc.) */
  reset?: () => void;
};
