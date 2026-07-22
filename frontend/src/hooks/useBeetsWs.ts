import { useEffect, useRef, useState, useCallback } from "react";

export type MatchInfo = {
  score: number;
  display: string;
  source: string;
  format: string;
  year: number | null;
  country: string | null;
  label: string | null;
  url: string | null;
  diff_summary: string;
  diff_artist: [string, string] | null;
  diff_album: [string, string] | null;
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
  year: number | null;
  label: string | null;
  catalog: string | null;
  media: string | null;
};

export type AlbumPrompt = {
  path: string;
  items: number;
  prompt_type: "apply_skip" | "candidate_select";
  default_candidate: number | null;
  match_info: MatchInfo | null;
  candidates: Candidate[];
};

export type BeetsMsg =
  | { type: "album_prompt" } & AlbumPrompt
  | { type: "log"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

export type BeetsAction =
  | { action: "apply" }
  | { action: "skip" }
  | { action: "use_as_is" }
  | { action: "more_candidates" }
  | { action: "select"; index: number }
  | { action: "enter_id"; id: string }
  | { action: "abort" };

export type BeetsStatus = "connecting" | "running" | "done" | "error" | "idle";

export function useBeetsWs(artist: string | null, album: string | null) {
  const [status, setStatus] = useState<BeetsStatus>("idle");
  const [current, setCurrent] = useState<AlbumPrompt | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    if (!artist || !album) return;
    if (wsRef.current) wsRef.current.close();

    setStatus("connecting");
    setCurrent(null);
    setLogs([]);

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/api/beets/ws?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setStatus("running");
    ws.onmessage = (e) => {
      const msg: BeetsMsg = JSON.parse(e.data);
      if (msg.type === "album_prompt") {
        setCurrent(msg as unknown as AlbumPrompt);
      } else if (msg.type === "log") {
        setLogs((l) => [...l, msg.text]);
      } else if (msg.type === "done") {
        setStatus("done");
        setCurrent(null);
      } else if (msg.type === "error") {
        setStatus("error");
        setLogs((l) => [...l, `Error: ${msg.message}`]);
      }
    };
    ws.onerror = () => setStatus("error");
    ws.onclose = () => {
      if (status === "running") setStatus("done");
    };
  }, [artist, album]);

  const send = useCallback((action: BeetsAction) => {
    wsRef.current?.send(JSON.stringify(action));
    setCurrent(null); // clear while waiting for next album
  }, []);

  useEffect(() => {
    return () => wsRef.current?.close();
  }, []);

  return { status, current, logs, connect, send };
}
