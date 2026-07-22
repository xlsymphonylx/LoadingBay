import { useEffect, useRef, useState, useCallback } from "react";
import { X, Loader, CheckCircle, XCircle, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import AlbumPromptCard from "./AlbumMatchCard";
import "./scss/BeetsPanel.scss";

// ── Backend frame types (match Rust BeetsFrame) ───────────────────────────

export type MatchInfo = {
  score: number;
  display: string;
  source: string;
  format: string;
  year?: number;
  country?: string;
  label?: string;
  url?: string;
  diff_summary: string;
  diff_artist?: [string, string];
  diff_album?: [string, string];
  diff_tracks: string[];
  missing_tracks: string[];
};

export type Candidate = {
  index: number;
  score: number;
  display: string;
  diff_summary: string;
  source: string;
  format: string;
  year?: number;
  label?: string;
};

export type AlbumPrompt = {
  path: string;
  items: number;
  prompt_type: "apply_skip" | "candidate_select";
  default_candidate?: number;
  match_info?: MatchInfo;
  candidates: Candidate[];
};

type Frame =
  | { type: "album_prompt" } & AlbumPrompt
  | { type: "log"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

// ── Actions sent to backend (match Rust ClientMsg) ────────────────────────

export type BeetsAction =
  | { action: "apply" }
  | { action: "skip" }
  | { action: "use_as_is" }
  | { action: "more_candidates" }
  | { action: "select"; index: number }
  | { action: "enter_id"; id: string }
  | { action: "abort" };

// ── Component ─────────────────────────────────────────────────────────────

const SKIP_PATTERNS = ["No files imported from", "Skipped", "already in the library"];

type Props = { artist: string; album: string; onClose: () => void; onFinished?: (succeeded: boolean) => void };

export default function BeetsPanel({ artist, album, onClose, onFinished }: Props) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [prompt, setPrompt] = useState<AlbumPrompt | null>(null);
  const [wasSkipped, setWasSkipped] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Close WS on unmount
  useEffect(() => {
    return () => { wsRef.current?.close(); };
  }, []);

  // Heartbeat ping every 2 minutes so the backend idle timer doesn't fire
  // while the user has the panel open (e.g. reading match details before deciding).
  useEffect(() => {
    if (status !== "running") return;
    const id = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ action: "ping" }));
      }
    }, 2 * 60 * 1000);
    return () => clearInterval(id);
  }, [status]);

  const handleFrame = useCallback((frame: Frame) => {
    if (frame.type === "album_prompt") {
      const { type: _, ...rest } = frame as Frame & { type: "album_prompt" };
      setPrompt(rest as AlbumPrompt);
    } else if (frame.type === "log") {
      setLogs((p) => [...p, frame.text]);
      if (SKIP_PATTERNS.some((pat) => frame.text.includes(pat))) {
        setWasSkipped(true);
      }
    } else if (frame.type === "done") {
      setStatus("done");
      setPrompt(null);
      onFinished?.(true);
    } else if (frame.type === "error") {
      setStatus("error");
      setErrorMsg(frame.message);
      setPrompt(null);
      onFinished?.(false);
    }
  }, []);

  function start(force = false) {
    setStatus("running");
    setLogs([]);
    setPrompt(null);
    setErrorMsg(null);
    setWasSkipped(false);
    const base = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/beets-ws`;
    const params = new URLSearchParams({ artist, album });
    if (force) params.set("force", "true");
    const ws = new WebSocket(`${base}?${params}`);
    wsRef.current = ws;
    ws.onmessage = (e) => {
      try { handleFrame(JSON.parse(e.data)); } catch (err) {
        console.warn("Beets WS parse error", err);
      }
    };
    ws.onerror = () => { setStatus("error"); setErrorMsg("WebSocket connection failed"); };
    ws.onclose = () => {};
  }

  function send(action: BeetsAction) {
    wsRef.current?.send(JSON.stringify(action));
    setPrompt(null); // clear while beets processes
  }

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const icon =
    status === "done"    ? <CheckCircle size={15} color="var(--success)" /> :
    status === "error"   ? <XCircle size={15} color="var(--error)" /> :
    status === "running" ? <Loader size={15} color="var(--info)" style={{ animation: "spin 1s linear infinite" }} /> :
    null;

  return (
    <div className="beets-panel__backdrop">
      <div className="beets-panel">
        <div className="beets-panel__header">
          <div className="beets-panel__header__info">
            {icon}
            <span className="beets-panel__header__title">
              beets — {artist}{album ? ` / ${album}` : ""}
            </span>
          </div>
          <button className="beets-panel__header__close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="beets-panel__body">
          {status === "idle" && (
            <button className="beets-panel__start-btn" onClick={() => start()}>
              <Play size={15} />
              {t('beets.run')}
            </button>
          )}

          {prompt && (
            <AlbumPromptCard prompt={prompt} onAction={send} />
          )}

          {logs.length > 0 && (
            <div className="beets-panel__logs">
              {logs.map((line, i) => (
                <div key={i} className="beets-panel__logs__line">{line}</div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}

          {status === "done" && !wasSkipped && (
            <div className="beets-panel__result beets-panel__result--done">{t('beets.done')} ✓</div>
          )}
          {status === "done" && wasSkipped && (
            <div className="beets-panel__force-prompt">
              <span>{t('beets.skipped')}</span>
              <div className="beets-panel__force-prompt__actions">
                <button className="beets-panel__force-prompt__yes" onClick={() => start(true)}>
                  {t('beets.force')}
                </button>
                <button className="beets-panel__force-prompt__no" onClick={onClose}>
                  {t('beets.close')}
                </button>
              </div>
            </div>
          )}
          {status === "error" && (
            <div className="beets-panel__result beets-panel__result--aborted">
              {errorMsg ?? t('beets.error')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
