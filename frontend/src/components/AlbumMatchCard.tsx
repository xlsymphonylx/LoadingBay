import { useState, useEffect } from "react";
import { CheckCircle, XCircle, ChevronDown, ChevronUp, SkipForward, RefreshCw, Ban, Image, Tag } from "lucide-react";
import type { AlbumPrompt, BeetsAction, MatchInfo, Candidate } from "./BeetsPanel";
import "./scss/AlbumMatchCard.scss";

type Props = { prompt: AlbumPrompt; onAction: (a: BeetsAction) => void };

type TidalMatch = { id: number; title: string; cover: string; artist: { name: string } };

export default function AlbumPromptCard({ prompt, onAction }: Props) {
  const [mbId, setMbId] = useState("");
  const [tracksOpen, setTracksOpen] = useState(false);

  const pathParts = prompt.path.split("/").filter(Boolean);
  const album = pathParts[pathParts.length - 1] ?? "";
  const artist = pathParts[pathParts.length - 2] ?? "";

  return (
    <div className="album-match">
      <div className="album-match__path">{prompt.path}</div>
      <div className="album-match__items">{prompt.items} item{prompt.items !== 1 ? "s" : ""}</div>

      {prompt.prompt_type === "apply_skip" && prompt.match_info && (
        <ApplySkipView
          key={prompt.match_info.url || ""}
          info={prompt.match_info}
          tracksOpen={tracksOpen}
          onToggleTracks={() => setTracksOpen(x => !x)}
          mbId={mbId}
          setMbId={setMbId}
          onAction={onAction}
          artist={artist}
          album={album}
        />
      )}

      {/* Fallback: apply_skip with no match_info (e.g. after MBID lookup beets skips the score line) */}
      {prompt.prompt_type === "apply_skip" && !prompt.match_info && (
        <ApplySkipFallback mbId={mbId} setMbId={setMbId} onAction={onAction} />
      )}

      {prompt.prompt_type === "candidate_select" && (
        <CandidateSelectView
          candidates={prompt.candidates}
          defaultIdx={prompt.default_candidate}
          mbId={mbId}
          setMbId={setMbId}
          onAction={onAction}
        />
      )}
    </div>
  );
}

// ── ApplySkip view ────────────────────────────────────────────────────────

function ApplySkipView({
  info, tracksOpen, onToggleTracks, mbId, setMbId, onAction, artist, album,
}: {
  info: MatchInfo;
  tracksOpen: boolean;
  onToggleTracks: () => void;
  mbId: string;
  setMbId: (v: string) => void;
  onAction: (a: BeetsAction) => void;
  artist: string;
  album: string;
}) {
  const pct = Math.round(info.score);
  const qualityClass =
    pct >= 90 ? "album-match__score--good" :
    pct >= 70 ? "album-match__score--ok" :
    "album-match__score--poor";

  const mbid = info.url ? info.url.split("/").pop() ?? "" : "";
  const mbCoverSrc = mbid ? `https://coverartarchive.org/release/${mbid}/front-250` : "";
  const [mbDims, setMbDims] = useState<string | null>(null);
  const [mbError, setMbError] = useState(false);

  const [tidalMatch, setTidalMatch] = useState<TidalMatch | null>(null);
  const [tidalLoading, setTidalLoading] = useState(true);
  const [tidalDims, setTidalDims] = useState<string | null>(null);
  const [tidalImgError, setTidalImgError] = useState(false);

  useEffect(() => {
    const artistName = info.diff_artist?.[1] ?? info.display;
    const albumName = info.diff_album?.[1] ?? info.display;
    setTidalLoading(true);
    fetch(`/api/discover/album-match?artist=${encodeURIComponent(artistName)}&album=${encodeURIComponent(albumName)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        setTidalMatch(data && data.id ? data : null);
        setTidalLoading(false);
      })
      .catch(() => setTidalLoading(false));
  }, [info.url, info.display]);

  const tidalImgSrc = tidalMatch?.cover
    ? `https://resources.tidal.com/images/${tidalMatch.cover.replace(/-/g, "/")}/640x640.jpg`
    : "";

  const [coverStatus, setCoverStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [coverMsg, setCoverMsg] = useState("");
  const [tagsStatus, setTagsStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [tagsMsg, setTagsMsg] = useState("");

  const handleTidalCover = async () => {
    if (!tidalMatch) return;
    setCoverStatus("loading");
    try {
      const r = await fetch(`/api/music/${encodeURIComponent(artist)}/${encodeURIComponent(album)}/tidal-cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tidal_album_id: tidalMatch.id }),
      });
      if (r.ok) { setCoverStatus("done"); setCoverMsg("Cover applied ✓"); }
      else { setCoverStatus("error"); setCoverMsg("Error"); }
    } catch { setCoverStatus("error"); setCoverMsg("Error"); }
  };

  const handleTidalTags = async () => {
    if (!tidalMatch) return;
    setTagsStatus("loading");
    try {
      const r = await fetch(`/api/music/${encodeURIComponent(artist)}/${encodeURIComponent(album)}/tidal-tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tidal_album_id: tidalMatch.id }),
      });
      if (r.ok) {
        const data = await r.json();
        setTagsStatus("done");
        setTagsMsg(data.message ?? "Tagged ✓");
      } else { setTagsStatus("error"); setTagsMsg("Error"); }
    } catch { setTagsStatus("error"); setTagsMsg("Error"); }
  };

  return (
    <>
      <div className="album-match__covers">
        <div className="album-match__cover-card">
          <div className="album-match__cover-label">MusicBrainz</div>
          {mbCoverSrc && !mbError ? (
            <img
              src={mbCoverSrc}
              alt="MusicBrainz cover"
              onLoad={(e) => {
                const img = e.currentTarget;
                setMbDims(`${img.naturalWidth}×${img.naturalHeight}`);
              }}
              onError={() => setMbError(true)}
            />
          ) : (
            <div className="album-match__cover-placeholder">No CAA cover</div>
          )}
          {mbDims && <div className="album-match__cover-dims">{mbDims}</div>}
        </div>

        <div className="album-match__cover-card">
          <div className="album-match__cover-label">TIDAL</div>
          {tidalLoading ? (
            <div className="album-match__cover-placeholder" />
          ) : tidalImgSrc && !tidalImgError ? (
            <img
              src={tidalImgSrc}
              alt="TIDAL cover"
              onLoad={(e) => {
                const img = e.currentTarget;
                setTidalDims(`${img.naturalWidth}×${img.naturalHeight}`);
              }}
              onError={() => setTidalImgError(true)}
            />
          ) : (
            <div className="album-match__cover-placeholder">No TIDAL match</div>
          )}
          {tidalDims && <div className="album-match__cover-dims">{tidalDims}</div>}
        </div>
      </div>

      <div className="album-match__header">
        <div className="album-match__meta">
          {info.diff_artist ? (
            <span>
              <span className="album-match__meta__diff">{info.diff_artist[0]}</span>
              {" → "}
              <strong>{info.diff_artist[1]}</strong>
            </span>
          ) : null}
          {info.diff_album ? (
            <span className="album-match__meta__sep">
              <span className="album-match__meta__diff">{info.diff_album[0]}</span>
              {" → "}
              <strong>{info.diff_album[1]}</strong>
            </span>
          ) : null}
          {!info.diff_artist && !info.diff_album && (
            <strong>{info.display}</strong>
          )}
          {info.year && <span className="album-match__meta__year"> ({info.year})</span>}
        </div>
        <div className={`album-match__score ${qualityClass}`}>{pct}%</div>
      </div>

      {info.source && (
        <div className="album-match__source">
          {info.source}{info.format ? ` · ${info.format}` : ""}
          {info.url && (
            <a href={info.url} target="_blank" rel="noreferrer" className="album-match__source__link"> ↗</a>
          )}
        </div>
      )}

      {(info.diff_tracks.length > 0 || info.missing_tracks.length > 0) && (
        <button className="album-match__expand-btn" onClick={onToggleTracks}>
          {tracksOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {info.diff_tracks.length} diff{info.diff_tracks.length !== 1 ? "s" : ""}
          {info.missing_tracks.length > 0 && `, ${info.missing_tracks.length} missing`}
        </button>
      )}

      {tracksOpen && (
        <div className="album-match__tracks">
          {info.diff_tracks.map((t, i) => (
            <div key={i} className="album-match__track album-match__track--bad">
              <XCircle size={11} color="var(--warning)" /> {t}
            </div>
          ))}
          {info.missing_tracks.map((t, i) => (
            <div key={`m${i}`} className="album-match__track album-match__track--missing">
              <XCircle size={11} color="var(--error)" /> {t}
            </div>
          ))}
        </div>
      )}

      <MbIdInput mbId={mbId} setMbId={setMbId} onAction={onAction} />

      <div className="album-match__actions">
        <button className="album-match__action album-match__action--accept" onClick={() => onAction({ action: "apply" })}>
          <CheckCircle size={13} /> Apply
        </button>
        <button className="album-match__action album-match__action--secondary" onClick={() => onAction({ action: "use_as_is" })}>
          Use as-is
        </button>
        <button className="album-match__action album-match__action--secondary" onClick={() => onAction({ action: "more_candidates" })}>
          <RefreshCw size={12} /> More
        </button>
        <button className="album-match__action album-match__action--skip" onClick={() => onAction({ action: "skip" })}>
          <SkipForward size={13} /> Skip
        </button>
        <button className="album-match__action album-match__action--abort" onClick={() => onAction({ action: "abort" })}>
          <Ban size={13} /> Abort
        </button>
      </div>

      {tidalMatch !== null && (
        <div className="album-match__tidal-actions">
          <button
            disabled={coverStatus === "loading" || tagsStatus === "loading"}
            onClick={handleTidalCover}
          >
            <Image size={13} />
            {coverStatus === "idle" && "Use TIDAL cover"}
            {coverStatus === "loading" && "Applying…"}
            {(coverStatus === "done" || coverStatus === "error") && coverMsg}
          </button>
          <button
            disabled={coverStatus === "loading" || tagsStatus === "loading"}
            onClick={handleTidalTags}
          >
            <Tag size={13} />
            {tagsStatus === "idle" && "Use TIDAL metadata"}
            {tagsStatus === "loading" && "Tagging…"}
            {(tagsStatus === "done" || tagsStatus === "error") && tagsMsg}
          </button>
        </div>
      )}
    </>
  );
}

// ── ApplySkip fallback (no match_info) ───────────────────────────────────

function ApplySkipFallback({ mbId, setMbId, onAction }: {
  mbId: string;
  setMbId: (v: string) => void;
  onAction: (a: BeetsAction) => void;
}) {
  return (
    <>
      <div className="album-match__notice">Beets is ready to apply — no match details available.</div>
      <MbIdInput mbId={mbId} setMbId={setMbId} onAction={onAction} />
      <div className="album-match__actions">
        <button className="album-match__action album-match__action--accept" onClick={() => onAction({ action: "apply" })}>
          Apply
        </button>
        <button className="album-match__action album-match__action--secondary" onClick={() => onAction({ action: "use_as_is" })}>
          Use as-is
        </button>
        <button className="album-match__action album-match__action--skip" onClick={() => onAction({ action: "skip" })}>
          Skip
        </button>
        <button className="album-match__action album-match__action--abort" onClick={() => onAction({ action: "abort" })}>
          Abort
        </button>
      </div>
    </>
  );
}

// ── CandidateSelect view ──────────────────────────────────────────────────

function CandidateSelectView({
  candidates, defaultIdx, mbId, setMbId, onAction,
}: {
  candidates: Candidate[];
  defaultIdx?: number;
  mbId: string;
  setMbId: (v: string) => void;
  onAction: (a: BeetsAction) => void;
}) {
  return (
    <>
      <div className="album-match__candidates">
        {candidates.map((c) => {
          const pct = Math.round(c.score);
          const qualityClass =
            pct >= 90 ? "album-match__score--good" :
            pct >= 70 ? "album-match__score--ok" :
            "album-match__score--poor";
          return (
            <button
              key={c.index}
              className={`album-match__candidate${c.index === defaultIdx ? " album-match__candidate--default" : ""}`}
              onClick={() => onAction({ action: "select", index: c.index })}
            >
              <span className="album-match__candidate__idx">{c.index}.</span>
              <div className="album-match__candidate__info">
                <span>{c.display}</span>
                {c.year && <span className="album-match__meta__year"> ({c.year})</span>}
                {c.diff_summary && <span className="album-match__candidate__diff">{c.diff_summary}</span>}
              </div>
              <span className={`album-match__score ${qualityClass}`}>{pct}%</span>
            </button>
          );
        })}
      </div>

      <MbIdInput mbId={mbId} setMbId={setMbId} onAction={onAction} />

      <div className="album-match__actions">
        <button className="album-match__action album-match__action--skip" onClick={() => onAction({ action: "skip" })}>
          <SkipForward size={13} /> Skip
        </button>
        <button className="album-match__action album-match__action--abort" onClick={() => onAction({ action: "abort" })}>
          <Ban size={13} /> Abort
        </button>
      </div>
    </>
  );
}

// ── Shared MB ID input ────────────────────────────────────────────────────

function MbIdInput({ mbId, setMbId, onAction }: {
  mbId: string;
  setMbId: (v: string) => void;
  onAction: (a: BeetsAction) => void;
}) {
  return (
    <div className="album-match__mb-input">
      <input
        className="album-match__mb-input__field"
        placeholder="Enter MusicBrainz release ID…"
        value={mbId}
        onChange={(e) => setMbId(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && mbId.trim()) {
            onAction({ action: "enter_id", id: mbId.trim() });
            setMbId("");
          }
        }}
      />
      <button
        className="album-match__mb-input__apply"
        disabled={!mbId.trim()}
        onClick={() => { onAction({ action: "enter_id", id: mbId.trim() }); setMbId(""); }}
      >
        Apply ID
      </button>
    </div>
  );
}
