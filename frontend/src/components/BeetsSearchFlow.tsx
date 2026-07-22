import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Loader, CheckCircle, XCircle, Play, ChevronLeft } from "lucide-react";
import AlbumPromptCard from "./AlbumMatchCard";
import type { AlbumPrompt, BeetsAction, Candidate, MatchInfo } from "./BeetsPanel";
import { apiFetch } from "../context/AuthContext";
import type { MetadataCandidate, ProviderResult } from "../types/metadataTypes";
import "./scss/BeetsSearchFlow.scss";

// ── MusicBrainz API types ─────────────────────────────────────────────────────

type MbTrack = {
  number: string | number;
  title: string;
  position?: number;
};

type MbMedia = {
  tracks?: MbTrack[];
};

type MbRelease = {
  id: string;
  title: string;
  date?: string;
  "artist-credit"?: { name: string; artist?: { name: string } }[];
  media?: MbMedia[];
  cover_url?: string;
};

// ── Frame type (matches BeetsPanel) ──────────────────────────────────────────

type Frame =
  | ({ type: "album_prompt" } & AlbumPrompt)
  | { type: "log"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

const SKIP_PATTERNS = ["No files imported from", "Skipped", "already in the library"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractMbid(url: string | undefined): string | null {
  if (!url) return null;
  const match = url.match(/musicbrainz\.org\/release\/([0-9a-f-]+)/i);
  return match ? match[1] : null;
}

async function fetchMbRelease(mbid: string): Promise<MbRelease | null> {
  try {
    const r = await apiFetch(`/api/mb/release/${mbid}`);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function buildCandidateFromMatchInfo(
  info: MatchInfo,
  mbRelease: MbRelease | null,
  mbid: string | null,
): MetadataCandidate {
  const artistName = info.diff_artist?.[1] ?? info.display.split(" - ")[0] ?? info.display;
  const albumTitle = info.diff_album?.[1]  ?? info.display.split(" - ").slice(1).join(" - ") ?? info.display;
  const year = info.year ?? (mbRelease?.date ? parseInt(mbRelease.date.slice(0, 4), 10) || null : null);

  const tracks: { pos: number; title: string }[] = [];
  if (mbRelease?.media) {
    let pos = 1;
    for (const media of mbRelease.media) {
      for (const t of media.tracks ?? []) {
        tracks.push({ pos: typeof t.number === "number" ? t.number : pos, title: t.title });
        pos++;
      }
    }
  }

  const coverUrl = mbRelease?.cover_url
    ?? (mbid ? `https://coverartarchive.org/release/${mbid}/front` : null);

  return {
    source: "musicbrainz",
    albumTitle,
    artistName,
    year: typeof year === "number" && !isNaN(year) ? year : null,
    coverUrl,
    tracks,
    score: Math.round(info.score),
    mbReleaseId: mbid ?? undefined,
  };
}

function buildCandidatesFromList(candidates: Candidate[]): MetadataCandidate[] {
  return candidates.map(c => {
    const parts  = c.display.split(" - ");
    const artist = parts[0]?.trim() ?? c.display;
    const title  = parts.slice(1).join(" - ").trim() || c.display;
    return {
      source: "musicbrainz",
      albumTitle: title,
      artistName: artist,
      year: c.year ?? null,
      coverUrl: null,
      tracks: [],
      score: Math.round(c.score),
    };
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  artist: string;
  album: string;
  onResult: (r: ProviderResult) => void;
  onBack: () => void;
};

export default function BeetsSearchFlow({ artist, album, onResult, onBack }: Props) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [prompt, setPrompt] = useState<AlbumPrompt | null>(null);
  const [wasSkipped, setWasSkipped] = useState(false);
  const [showMbInput, setShowMbInput] = useState(false);
  const [mbidInput, setMbidInput] = useState("");
  const [mbidLoading, setMbidLoading] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  /** Resolve fn set when candidate_select apply is waiting for the next apply_skip frame */
  const onNextApplySkipRef = useRef<((p: AlbumPrompt) => void) | null>(null);

  useEffect(() => {
    start();
    return () => { wsRef.current?.close(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Heartbeat ping while running
  useEffect(() => {
    if (status !== "running") return;
    const id = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ action: "ping" }));
      }
    }, 2 * 60 * 1000);
    return () => clearInterval(id);
  }, [status]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleFrame = useCallback(
    async (frame: Frame) => {
      if (frame.type === "log") {
        setLogs(p => [...p, frame.text]);
        if (SKIP_PATTERNS.some(pat => frame.text.includes(pat))) {
          setWasSkipped(true);
        }
        // Show MB ID input if beets says no match
        if (frame.text.toLowerCase().includes("no match")) {
          setShowMbInput(true);
        }
        return;
      }

      if (frame.type === "done") {
        setStatus("done");
        setPrompt(null);
        return;
      }

      if (frame.type === "error") {
        setStatus("error");
        setErrorMsg(frame.message);
        setPrompt(null);
        return;
      }

      if (frame.type === "album_prompt") {
        const { type: _, ...rest } = frame as Frame & { type: "album_prompt" };
        const albumPrompt = rest as AlbumPrompt;

        // If candidate_select apply is waiting for next apply_skip, auto-resolve it
        if (albumPrompt.prompt_type === "apply_skip" && onNextApplySkipRef.current) {
          const cb = onNextApplySkipRef.current;
          onNextApplySkipRef.current = null;
          cb(albumPrompt);
          return;
        }

        setPrompt(albumPrompt);

        if (albumPrompt.prompt_type === "apply_skip" && albumPrompt.match_info) {
          const info = albumPrompt.match_info;
          const mbid = extractMbid(info.url);
          const mbRelease = mbid ? await fetchMbRelease(mbid) : null;
          const candidate = buildCandidateFromMatchInfo(info, mbRelease, mbid);

          const providerResult: ProviderResult = {
            candidates: [candidate],
            apply: async () => {
              sendAction({ action: "apply" });
            },
            reset: () => {
              // Prompt is still waiting — send skip to go back to log view
              sendAction({ action: "skip" });
              setPrompt(null);
            },
          };
          onResult(providerResult);

        } else if (albumPrompt.prompt_type === "candidate_select") {
          const mbCandidates = buildCandidatesFromList(albumPrompt.candidates);

          const providerResult: ProviderResult = {
            candidates: mbCandidates,
            apply: async (index) => {
              // Beets candidate indices are 1-based
              const beetsIndex = albumPrompt.candidates[index]?.index ?? index + 1;
              sendAction({ action: "select", index: beetsIndex });
              // Wait for beets to send back apply_skip, then auto-apply
              await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                  onNextApplySkipRef.current = null;
                  reject(new Error("Timed out waiting for beets apply_skip"));
                }, 30_000);
                onNextApplySkipRef.current = () => {
                  clearTimeout(timeout);
                  sendAction({ action: "apply" });
                  resolve();
                };
              });
            },
            reset: () => {
              sendAction({ action: "skip" });
              setPrompt(null);
            },
          };
          onResult(providerResult);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onResult],
  );

  function start(force = false) {
    setStatus("running");
    setLogs([]);
    setPrompt(null);
    setErrorMsg(null);
    setWasSkipped(false);
    setShowMbInput(false);
    onNextApplySkipRef.current = null;

    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const params = new URLSearchParams({ artist, album });
    if (force) params.set("force", "true");
    const ws = new WebSocket(`${protocol}://${location.host}/api/beets-ws?${params}`);
    wsRef.current = ws;

    ws.onmessage = e => {
      try { handleFrame(JSON.parse(e.data)); } catch (err) {
        console.warn("Beets WS parse error", err);
      }
    };
    ws.onerror = () => { setStatus("error"); setErrorMsg("WebSocket connection failed"); };
    ws.onclose = () => {};
  }

  function sendAction(action: BeetsAction) {
    wsRef.current?.send(JSON.stringify(action));
    setPrompt(null);
  }

  async function handleMbidSubmit() {
    if (!mbidInput.trim()) return;
    const mbid = mbidInput.trim();
    setMbidLoading(true);
    try {
      const mbRelease = await fetchMbRelease(mbid);
      const fakeInfo: MatchInfo = {
        score: 100,
        display: mbRelease?.title ?? mbid,
        source: "musicbrainz",
        format: "",
        year: mbRelease?.date ? parseInt(mbRelease.date.slice(0, 4), 10) || undefined : undefined,
        url: `https://musicbrainz.org/release/${mbid}`,
        diff_summary: "",
        diff_tracks: [],
        missing_tracks: [],
      };
      const candidate = buildCandidateFromMatchInfo(fakeInfo, mbRelease, mbid);

      const providerResult: ProviderResult = {
        candidates: [candidate],
        apply: async () => {
          sendAction({ action: "enter_id", id: mbid });
          // Wait for beets to confirm with apply_skip, then apply
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              onNextApplySkipRef.current = null;
              reject(new Error("Timed out waiting for beets response"));
            }, 30_000);
            onNextApplySkipRef.current = () => {
              clearTimeout(timeout);
              sendAction({ action: "apply" });
              resolve();
            };
          });
        },
      };
      onResult(providerResult);
    } finally {
      setMbidLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const statusIcon =
    status === "done"    ? <CheckCircle size={15} color="var(--success)" /> :
    status === "error"   ? <XCircle size={15} color="var(--error)" /> :
    status === "running" ? <Loader size={15} style={{ animation: "spin 1s linear infinite" }} /> :
    null;

  return (
    <div className="beets-flow">
      <div className="beets-flow__header">
        <button className="beets-flow__back" onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4, fontSize: 12, padding: 0 }}>
          <ChevronLeft size={14} /> {t("metadata.choose_provider")}
        </button>
        {statusIcon && <span className="beets-flow__status-icon">{statusIcon}</span>}
        <span>beets — {artist}{album ? ` / ${album}` : ""}</span>
      </div>

      {status === "idle" && (
        <button className="beets-flow__start-btn" onClick={() => start()}>
          <Play size={15} />
          Run beets        </button>
      )}

      {prompt && (
        <AlbumPromptCard prompt={prompt} onAction={sendAction} />
      )}

      {showMbInput && status === "running" && (
        <div className="beets-flow__mbid-form">
          <span className="beets-flow__mbid-form__label">{t("metadata.mbid_label")}</span>
          <div className="beets-flow__mbid-form__row">
            <input
              className="beets-flow__mbid-form__input"
              placeholder={t("metadata.mbid_placeholder")}
              value={mbidInput}
              onChange={e => setMbidInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleMbidSubmit(); }}
            />
            <button
              className="beets-flow__mbid-form__btn"
              disabled={!mbidInput.trim() || mbidLoading}
              onClick={handleMbidSubmit}
            >
              {mbidLoading
                ? <Loader size={13} style={{ animation: "spin 1s linear infinite" }} />
                : t("metadata.mbid_lookup")}
            </button>
          </div>
        </div>
      )}

      {logs.length > 0 && (
        <div className="beets-flow__logs">
          {logs.map((line, i) => (
            <div key={i} className="beets-flow__log-line">{line}</div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}

      {status === "done" && !wasSkipped && (
        <div className="beets-flow__done">
          <CheckCircle size={15} /> Done ✓
        </div>
      )}

      {status === "done" && wasSkipped && (
        <div className="beets-flow__skipped">
          <span className="beets-flow__skipped__label">
            {t("metadata.beets_skipped")}
          </span>
          <div className="beets-flow__skipped__actions">
            <button className="beets-flow__skipped__force" onClick={() => start(true)}>
              {t("metadata.beets_force")}
            </button>
            <button className="beets-flow__skipped__cancel" onClick={onBack}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="beets-flow__error">
          {errorMsg ?? "An error occurred"}
        </div>
      )}
    </div>
  );
}
