import { useEffect, useRef, useState } from "react";
import { unauthorizedCallbackRef } from "../context/AuthContext";

export type JobId = string;

export type JobStatus =
  | "queued"
  | "downloading"
  | "unzipping"
  | "parsing"
  | "awaiting_prompt"
  | "copying"
  | "done"
  | "cancelled"
  | "error";

export type SeparatorOption = {
  label: string;
  album: string;
  artist: string;
};

export type Prompt =
  | { kind: "separator_choice"; filename: string; options: SeparatorOption[] }
  | { kind: "artist_missing"; artist: string }
  | { kind: "album_exists"; artist: string; album: string }
  | { kind: "review_tracks"; tracks: string[]; staged_tracks: string[] };

export type JobState = {
  id: JobId;
  filename: string;
  status: JobStatus;
  messages: string[];
  prompt: Prompt | null;
  artist: string | null;
  album: string | null;
  source: "import" | "discover";
  album_id?: number;
};

type SsePayload = {
  job_id: JobId;
  filename: string;
  status: JobStatus;
  message: string | null;
  prompt: Prompt | null;
  artist: string | null;
  album: string | null;
  source?: string;
  album_id?: number;
};

export function useJobStream() {
  const [jobs, setJobs] = useState<Map<JobId, JobState>>(new Map());
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      const es = new EventSource("/api/events");
      esRef.current = es;

      es.onmessage = (e) => {
        try {
          const payload: SsePayload = JSON.parse(e.data);
          setJobs((prev) => {
            const next = new Map(prev);
            const existing = next.get(payload.job_id);
            const messages = existing ? [...existing.messages] : [];
            if (payload.message && !messages.includes(payload.message)) {
              messages.push(payload.message);
            }
            next.set(payload.job_id, {
              id: payload.job_id,
              filename: payload.filename || existing?.filename || payload.job_id,
              status: payload.status,
              messages,
              prompt: payload.prompt,
              artist: payload.artist ?? existing?.artist ?? null,
              album: payload.album ?? existing?.album ?? null,
              source: (payload.source === "discover" ? "discover" : "import") as "import" | "discover",
              album_id: payload.album_id ?? existing?.album_id,
            });
            return next;
          });
        } catch (err) {
          console.warn("SSE parse error", err);
        }
      };

      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (!cancelled) {
          // Check if the session expired — if /api/auth/me returns 401, log out
          fetch("/api/auth/me").then((r) => {
            if (r.status === 401) {
              unauthorizedCallbackRef.current();
            } else if (!cancelled) {
              setTimeout(connect, 3000);
            }
          }).catch(() => {
            if (!cancelled) setTimeout(connect, 3000);
          });
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      esRef.current?.close();
      esRef.current = null;
    };
  }, []);

  return { jobs };
}
