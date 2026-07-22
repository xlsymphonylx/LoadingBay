import { useRef, useState, useCallback } from "react";
import type { JobState } from "./useJobStream";
import { uploadFileChunked } from "./useChunkedUpload";
import { apiFetch } from "../context/AuthContext";

export type StagedFile = {
  id: string;
  file: File;
  runBeets: boolean;
  runLyrics: boolean;
  jobId?: string;
  artist?: string;
  album?: string;
  phase: "staged" | "uploading" | "processing" | "beets" | "lyrics" | "done" | "failed";
  failReason?: string;
  beetsStatus?: "running" | "done" | "failed";
  lyricsStatus?: "running" | "done" | "failed";
  uploadProgress?: { sent: number; total: number };
};

export type SequencerOptions = {
  jobsRef: React.MutableRefObject<Map<string, JobState>>;
  beetsResolveRef: React.MutableRefObject<((succeeded: boolean) => void) | null>;
  onOpenBeets: (artist: string, album: string) => void;
  onCloseBeets: () => void;
};

/** Max simultaneous uploads. Processing (beets/lyrics) is always sequential. */
const UPLOAD_CONCURRENCY = 3;
const MAX_LYRICS_MS = 2 * 60_000;
const MAX_IMPORT_WAIT_MS = 30 * 60_000;

function waitForJob(
  jobId: string,
  jobsRef: React.MutableRefObject<Map<string, JobState>>,
): Promise<JobState> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    function check() {
      const job = jobsRef.current.get(jobId);
      if (job && (job.status === "done" || job.status === "error" || job.status === "cancelled")) {
        resolve(job);
      } else if (Date.now() - started > MAX_IMPORT_WAIT_MS) {
        reject(new Error("Import timed out waiting for server job to finish"));
      } else {
        setTimeout(check, 500);
      }
    }
    check();
  });
}

/**
 * Run an array of async tasks with at most `limit` running concurrently.
 * Tasks must handle their own errors — this resolves once all have settled.
 */
function runConcurrently(tasks: Array<() => Promise<void>>, limit: number): Promise<void> {
  return new Promise((resolve) => {
    let index = 0;
    let running = 0;

    function next() {
      while (running < limit && index < tasks.length) {
        const task = tasks[index++];
        running++;
        task().finally(() => {
          running--;
          next();
          if (running === 0 && index >= tasks.length) resolve();
        });
      }
      if (running === 0 && index >= tasks.length) resolve();
    }

    next();
  });
}

export function useBatchSequencer(options: SequencerOptions) {
  const [mode, setMode] = useState<"staging" | "running" | "done">("staging");
  const [items, setItems] = useState<StagedFile[]>([]);
  /** Index of the item currently in beets/lyrics phase; -1 = none. */
  const [processingIndex, setProcessingIndex] = useState(-1);
  const cancelRef = useRef(false);
  const itemsRef = useRef<StagedFile[]>([]);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  function updateItem(id: string, updates: Partial<StagedFile>) {
    itemsRef.current = itemsRef.current.map((it) =>
      it.id === id ? { ...it, ...updates } : it,
    );
    setItems([...itemsRef.current]);
  }

  const startBatch = useCallback(async (staged: StagedFile[]) => {
    itemsRef.current = [...staged];
    setItems([...staged]);
    setMode("running");
    setProcessingIndex(-1);
    cancelRef.current = false;

    function runBeets(artist: string, album: string): Promise<boolean> {
      return new Promise<boolean>((resolve) => {
        optionsRef.current.beetsResolveRef.current = resolve;
        optionsRef.current.onOpenBeets(artist, album);
      }).then((ok) => {
        optionsRef.current.onCloseBeets();
        return ok;
      });
    }

    // Beets and lyrics must run sequentially (beets is interactive).
    // Chain promises so each item's post-upload work waits for the previous.
    let processingChain = Promise.resolve();

    function enqueueProcessing(item: StagedFile, jobId: string) {
      const idx = staged.findIndex((s) => s.id === item.id);
      processingChain = processingChain.then(async () => {
        if (cancelRef.current) return;
        setProcessingIndex(idx);

        // Wait for server-side job (may go through awaiting_prompt review step).
        let jobState: JobState;
        try {
          jobState = await waitForJob(jobId, optionsRef.current.jobsRef);
        } catch (e) {
          updateItem(item.id, {
            phase: "failed",
            failReason: e instanceof Error ? e.message : "Import timed out",
          });
          setProcessingIndex(-1);
          return;
        }
        if (jobState.status === "error" || jobState.status === "cancelled") {
          updateItem(item.id, {
            phase: "failed",
            failReason: jobState.status === "cancelled" ? "Import cancelled" : "Import failed",
          });
          setProcessingIndex(-1);
          return;
        }

        const artist = jobState.artist ?? "";
        const album = jobState.album ?? "";
        updateItem(item.id, { artist, album });

        // Beets
        let beetsOk = !item.runBeets;
        if (item.runBeets && artist && album) {
          updateItem(item.id, { phase: "beets", beetsStatus: "running" });
          const ok = await runBeets(artist, album);
          updateItem(item.id, { beetsStatus: ok ? "done" : "failed" });
          beetsOk = ok;
        }

        // Lyrics
        if (item.runLyrics && artist && album && beetsOk) {
          updateItem(item.id, { phase: "lyrics", lyricsStatus: "running" });
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), MAX_LYRICS_MS);
            const res = await apiFetch(
              `/api/music/${encodeURIComponent(artist)}/${encodeURIComponent(album)}/lyrics`,
              { method: "POST", signal: controller.signal },
            );
            clearTimeout(timer);
            const data = await res.json();
            updateItem(item.id, { lyricsStatus: data.success ? "done" : "failed" });
          } catch {
            updateItem(item.id, { lyricsStatus: "failed" });
          }
        }

        updateItem(item.id, { phase: "done" });
        setProcessingIndex(-1);
      });
    }

    // Build one upload task per file; run up to UPLOAD_CONCURRENCY at once.
    // Each task ONLY does the file transfer, then enqueues for sequential processing.
    const uploadTasks = staged.map((item) => async () => {
      if (cancelRef.current) return;

      updateItem(item.id, { phase: "uploading", uploadProgress: { sent: 0, total: 1 } });

      let jobId: string;
      try {
        const controller = new AbortController();
        const summary = await uploadFileChunked(
          item.file,
          (sent, total) => updateItem(item.id, { uploadProgress: { sent, total } }),
          controller.signal,
        );
        if (summary.skipped) {
          updateItem(item.id, { phase: "failed", failReason: summary.skip_reason ?? "Skipped" });
          return;
        }
        jobId = summary.id;
        updateItem(item.id, { phase: "processing", jobId, uploadProgress: undefined });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Upload failed";
        updateItem(item.id, { phase: "failed", failReason: msg, uploadProgress: undefined });
        return;
      }

      // Hand off to the sequential chain for server-side processing + beets/lyrics.
      // This keeps the interactive "awaiting_prompt" review step strictly one-at-a-time.
      enqueueProcessing(item, jobId);
    });

    // Wait for all file transfers to finish (processing is enqueued as they complete).
    await runConcurrently(uploadTasks, UPLOAD_CONCURRENCY);

    // Wait for all beets/lyrics processing to finish.
    await processingChain;

    setProcessingIndex(-1);
    setMode("done");
  }, []);

  function cancelAfterCurrent() {
    cancelRef.current = true;
  }

  function reset() {
    setMode("staging");
    setItems([]);
    setProcessingIndex(-1);
    cancelRef.current = false;
    itemsRef.current = [];
  }

  return { mode, items, processingIndex, startBatch, cancelAfterCurrent, reset };
}
