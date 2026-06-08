/**
 * Auth Store — Zustand
 * SÉCURITÉ: Aucun token n'est stocké dans localStorage ou sessionStorage.
 * L'authentification est entièrement gérée par des cookies HTTPOnly côté serveur.
 * Ce store ne contient que l'état de l'utilisateur en mémoire (RAM) pour le rendu React.
 */
import { create } from 'zustand';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
}

interface AuthState {
  user: AuthUser | null;
  // Aliases utilisés dans page.tsx
  loading: boolean;
  initialized: boolean;
  // Méthodes
  isAdmin: () => boolean;
  initialize: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: false,
  initialized: false,

  isAdmin: () => {
    const { user } = get();
    return user?.role === 'admin';
  },

  initialize: async () => {
    set({ loading: true });
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (res.ok) {
        const user = await res.json();
        set({ user, loading: false, initialized: true });
      } else {
        set({ user: null, loading: false, initialized: true });
      }
    } catch {
      set({ user: null, loading: false, initialized: true });
    }
  },

  login: async (email: string, password: string) => {
    set({ loading: true });
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Identifiants invalides');
      }
      const user = await res.json();
      set({ user, loading: false });
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },

  logout: async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {}
    set({ user: null, initialized: true });
  },

  checkAuth: async () => {
    return get().initialize();
  },
}));