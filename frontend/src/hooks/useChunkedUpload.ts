import { apiFetch } from "../context/AuthContext";

const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB per chunk
const MAX_RETRIES = 3;

export type ChunkedUploadResult = {
  id: string;
  filename: string;
  skipped: boolean;
  skip_reason: string | null;
};

// ── localStorage helpers ───────────────────────────────────────────────────────

function lsKey(filename: string, size: number) {
  return `lb_upload_${filename}:${size}`;
}

function saveSession(filename: string, size: number, uploadId: string) {
  try { localStorage.setItem(lsKey(filename, size), JSON.stringify({ uploadId })); } catch {}
}

function loadSession(filename: string, size: number): string | null {
  try {
    const raw = localStorage.getItem(lsKey(filename, size));
    if (!raw) return null;
    return JSON.parse(raw).uploadId ?? null;
  } catch { return null; }
}

function clearSession(filename: string, size: number) {
  try { localStorage.removeItem(lsKey(filename, size)); } catch {}
}

// ── API calls ─────────────────────────────────────────────────────────────────

async function initUpload(filename: string, totalSize: number, totalChunks: number): Promise<string> {
  const res = await apiFetch("/api/upload/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, total_size: totalSize, total_chunks: totalChunks }),
  });
  if (!res.ok) throw new Error(`Upload init failed (HTTP ${res.status})`);
  const data = await res.json();
  return data.upload_id;
}

async function getReceivedChunks(uploadId: string): Promise<Set<number>> {
  const res = await apiFetch(`/api/upload/${uploadId}`);
  if (!res.ok) throw new Error(`Status check failed (HTTP ${res.status})`);
  const data = await res.json();
  return new Set<number>(data.received);
}

async function sendChunk(uploadId: string, n: number, chunk: Blob, signal: AbortSignal): Promise<void> {
  const res = await apiFetch(`/api/upload/${uploadId}/chunk/${n}`, {
    method: "PUT",
    body: chunk,
    signal,
  });
  if (!res.ok) throw new Error(`Chunk ${n} failed (HTTP ${res.status})`);
}

async function finalizeUpload(uploadId: string): Promise<ChunkedUploadResult> {
  const res = await apiFetch(`/api/upload/${uploadId}`, { method: "POST" });
  if (!res.ok) {
    const msg = await res.json().then((d) => d.error).catch(() => `HTTP ${res.status}`);
    throw new Error(`Finalize failed: ${msg}`);
  }
  const data = await res.json();
  return data.jobs[0] as ChunkedUploadResult;
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Upload a file in chunks with automatic resume and per-chunk retry.
 * Progress is reported as (chunksDelivered, totalChunks).
 * Stores the upload session in localStorage so a page refresh can resume.
 */
export async function uploadFileChunked(
  file: File,
  onProgress: (sent: number, total: number) => void,
  signal: AbortSignal,
): Promise<ChunkedUploadResult> {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE) || 1;

  // Try to resume an existing session
  let uploadId = loadSession(file.name, file.size);
  let received = new Set<number>();

  if (uploadId) {
    try {
      received = await getReceivedChunks(uploadId);
    } catch {
      // Session expired or gone — start fresh
      uploadId = null;
    }
  }

  if (!uploadId) {
    uploadId = await initUpload(file.name, file.size, totalChunks);
    received = new Set();
  }

  saveSession(file.name, file.size, uploadId);

  // Send missing chunks sequentially
  for (let n = 0; n < totalChunks; n++) {
    if (signal.aborted) throw new DOMException("Upload cancelled", "AbortError");

    if (received.has(n)) {
      onProgress(n + 1, totalChunks);
      continue;
    }

    const start = n * CHUNK_SIZE;
    const chunk = file.slice(start, start + CHUNK_SIZE);

    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await sendChunk(uploadId, n, chunk, signal);
        lastError = undefined;
        break;
      } catch (e) {
        if (signal.aborted) throw e;
        lastError = e;
        // Exponential backoff: 1 s, 2 s, 4 s
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
    if (lastError) throw lastError;

    onProgress(n + 1, totalChunks);
  }

  const result = await finalizeUpload(uploadId);
  clearSession(file.name, file.size);
  return result;
}
