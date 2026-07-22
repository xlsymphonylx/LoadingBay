import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import i18n from "../i18n";

export type User = { id: string; username: string; is_admin: boolean; role: "admin" | "user" | "downloader"; language: string; require_file_review: boolean };

type AuthCtx = {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  onUnauthorized: () => void;
};

const AuthContext = createContext<AuthCtx | null>(null);

// Global callback ref so non-React code (hooks, fetch wrappers) can trigger logout
export const unauthorizedCallbackRef = { current: () => {} };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        setUser(u);
        if (u?.language) i18n.changeLanguage(u.language);
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const onUnauthorized = useCallback(() => {
    setUser(null);
  }, []);

  // Keep the global ref in sync so hooks can call it without needing context
  useEffect(() => {
    unauthorizedCallbackRef.current = onUnauthorized;
  }, [onUnauthorized]);

  async function login(username: string, password: string) {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? "Login failed");
    }
    const { user: u } = await res.json();
    if (u?.language) i18n.changeLanguage(u.language);
    setUser(u);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, onUnauthorized }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthCtx {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** Wrapper around fetch that auto-triggers logout on 401 */
export async function apiFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401) {
    unauthorizedCallbackRef.current();
  }
  return res;
}
