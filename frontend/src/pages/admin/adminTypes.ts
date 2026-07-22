export type AdminUser = {
  id: string;
  username: string;
  is_admin: boolean;
  role: "admin" | "user" | "downloader";
  language: string;
  require_file_review: boolean;
  created_at: string;
};

export type ImportRecord = {
  id: string;
  filename: string;
  artist: string;
  album: string;
  imported_at: string;
  beets_tagged: boolean;
  username?: string;
};

export type LogRecord = {
  id: number;
  created_at: string;
  level: string;
  component: string;
  message: string;
  job_id?: string;
  user_id?: string;
  artist?: string;
  album?: string;
};

export type QuotaInfo = {
  user_id: string;
  username: string;
  is_admin: boolean;
  downloads_today: number;
  bonus_credits: number;
  lifetime_imports: number;
  last_hour_imports: number;
  lifetime_deletions: number;
  file_deletions_today: number;
  file_bonus_credits: number;
};

export const COMPONENTS = ["upload", "import", "beets", "lyrics", "cover"] as const;
export const LEVELS = ["info", "warn", "error"] as const;

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
