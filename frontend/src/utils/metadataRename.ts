import { apiFetch } from "../context/AuthContext";
import type { ApplyOptions } from "../types/metadataTypes";

/**
 * After applying metadata tags, optionally rename artist/album folders
 * so folder names match the provider's metadata (e.g. fixes "##" → "Ñ").
 *
 * Returns the final [artist, album] folder names after any renames.
 * Throws if a rename request fails.
 */
export async function applyFolderRenames(
  artist: string,
  album: string,
  options: ApplyOptions | undefined,
): Promise<{ artist: string; album: string }> {
  let currentArtist = artist;
  let currentAlbum = album;

  if (options?.renameArtist && options.renameArtist !== artist) {
    const res = await apiFetch(
      `/api/music/${encodeURIComponent(artist)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: options.renameArtist }),
      }
    );
    if (!res.ok) {
      const msg = await res.text().catch(() => String(res.status));
      throw new Error(`Artist folder rename failed: ${msg}`);
    }
    currentArtist = options.renameArtist;
  }

  if (options?.renameAlbum && options.renameAlbum !== album) {
    const res = await apiFetch(
      `/api/music/${encodeURIComponent(currentArtist)}/${encodeURIComponent(album)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: options.renameAlbum }),
      }
    );
    if (!res.ok) {
      const msg = await res.text().catch(() => String(res.status));
      throw new Error(`Album folder rename failed: ${msg}`);
    }
    currentAlbum = options.renameAlbum;
  }

  return { artist: currentArtist, album: currentAlbum };
}
