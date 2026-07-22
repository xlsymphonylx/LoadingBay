import { Music2, Database, Radio, Music, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MetadataSource, ProviderResult } from "../types/metadataTypes";
import { useState } from "react";
import TidalSearchFlow from "./TidalSearchFlow";
import BeetsSearchFlow from "./BeetsSearchFlow";
import DeezerSearchFlow from "./DeezerSearchFlow";
import AllMusicSearchFlow from "./AllMusicSearchFlow";
import MetadataPreview from "./MetadataPreview";
import "./scss/MetadataProviderModal.scss";

type Props = {
  artist: string;
  album: string;
  onClose: () => void;
  onFinished?: (succeeded: boolean) => void;
};

type Step = "pick" | "search" | "preview";

const PROVIDER_IDS: { id: MetadataSource; name: string; icon: React.ReactNode }[] = [
  { id: "tidal",        name: "TIDAL",        icon: <Music2 size={22} /> },
  { id: "musicbrainz", name: "MusicBrainz",  icon: <Database size={22} /> },
  { id: "deezer",      name: "Deezer",        icon: <Radio size={22} /> },
  { id: "allmusic",    name: "AllMusic",      icon: <Music size={22} /> },
];

export default function MetadataProviderModal({ artist, album, onClose, onFinished }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>("pick");
  const [provider, setProvider] = useState<MetadataSource | null>(null);
  const [result, setResult] = useState<ProviderResult | null>(null);

  function pickProvider(p: MetadataSource) {
    setProvider(p);
    setStep("search");
  }

  function handleResult(r: ProviderResult) {
    setResult(r);
    setStep("preview");
  }

  function handleSearchBack() {
    setProvider(null);
    setStep("pick");
  }

  return (
    <div className="mp-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mp-modal__panel">
        <button className="mp-modal__close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>

        {step === "pick" && (
          <>
            <div className="mp-modal__header">
              <h2 className="mp-modal__title">{t("metadata.title")}</h2>
              <p className="mp-modal__subtitle">{album} — {artist}</p>
            </div>
            <div className="mp-modal__providers">
              {PROVIDER_IDS.map((p) => (
                <button
                  key={p.id}
                  className="mp-modal__provider-card"
                  onClick={() => pickProvider(p.id)}
                >
                  <span className="mp-modal__provider-card__icon">{p.icon}</span>
                  <span className="mp-modal__provider-card__name">{p.name}</span>
                  <span className="mp-modal__provider-card__desc">{t(`metadata.providers.${p.id}`)}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === "search" && provider === "tidal" && (
          <TidalSearchFlow
            artist={artist}
            album={album}
            onResult={handleResult}
            onBack={handleSearchBack}
          />
        )}

        {step === "search" && provider === "musicbrainz" && (
          <BeetsSearchFlow
            artist={artist}
            album={album}
            onResult={handleResult}
            onBack={handleSearchBack}
          />
        )}

        {step === "search" && provider === "deezer" && (
          <DeezerSearchFlow
            artist={artist}
            album={album}
            onResult={handleResult}
            onBack={handleSearchBack}
          />
        )}

        {step === "search" && provider === "allmusic" && (
          <AllMusicSearchFlow
            artist={artist}
            album={album}
            onResult={handleResult}
            onBack={handleSearchBack}
          />
        )}

        {step === "preview" && result && (
          <MetadataPreview
            artist={artist}
            album={album}
            result={result}
            onBack={() => {
              result.reset?.();
              setStep("search");
            }}
            onClose={onClose}
            onFinished={onFinished}
          />
        )}
      </div>
    </div>
  );
}
