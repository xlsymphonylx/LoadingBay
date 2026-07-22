import React, { createContext, useContext, useRef, useState } from "react";

export interface PlayerTrack {
  trackId?: number;
  title: string;
  artist: string;
  albumArt?: string;
  albumId?: number;
  src?: string;
}

interface PlayerCtx {
  track: PlayerTrack | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  play: (t: PlayerTrack) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  seek: (time: number) => void;
  setVolume: (v: number) => void;
}

const PlayerContext = createContext<PlayerCtx>({
  track: null,
  playing: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  play: () => {},
  pause: () => {},
  resume: () => {},
  stop: () => {},
  seek: () => {},
  setVolume: () => {},
});

export const usePlayer = () => useContext(PlayerContext);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [track, setTrack] = useState<PlayerTrack | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);

  // Create the audio element once (not on every render)
  if (!audioRef.current) {
    const audio = new Audio();
    audio.addEventListener("timeupdate", () => setCurrentTime(audio.currentTime));
    audio.addEventListener("durationchange", () => setDuration(isFinite(audio.duration) ? audio.duration : 0));
    audio.addEventListener("ended", () => setPlaying(false));
    audio.addEventListener("pause", () => setPlaying(false));
    audio.addEventListener("play", () => setPlaying(true));
    audio.addEventListener("error", () => setPlaying(false));
    audioRef.current = audio;
  }

  const play = (t: PlayerTrack) => {
    const audio = audioRef.current!;
    setTrack(t);
    setCurrentTime(0);
    setDuration(0);
    audio.src = t.src ?? `/api/discover/preview/${t.trackId}`;
    // Don't call audio.load() — setting src triggers an implicit load and calling
    // load() immediately before play() can cause AbortError in some browsers.
    audio.play().catch(() => setPlaying(false));
  };

  const pause = () => audioRef.current?.pause();

  const resume = () => audioRef.current?.play().catch(() => {});

  const stop = () => {
    const audio = audioRef.current!;
    audio.pause();
    audio.src = "";
    setTrack(null);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  };

  const seek = (time: number) => {
    if (audioRef.current) audioRef.current.currentTime = time;
  };

  const setVolume = (v: number) => {
    if (audioRef.current) audioRef.current.volume = v;
    setVolumeState(v);
  };

  return (
    <PlayerContext.Provider value={{ track, playing, currentTime, duration, volume, play, pause, resume, stop, seek, setVolume }}>
      {children}
    </PlayerContext.Provider>
  );
}
