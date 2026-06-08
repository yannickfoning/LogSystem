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
  isLoading: boolean;
  isInitialized: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: false,
  isInitialized: false,

  login: async (email: string, password: string) => {
    set({ isLoading: true });
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Cookie HTTPOnly géré par le navigateur
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Identifiants invalides');
      }
      const user = await res.json();
      set({ user, isLoading: false });
    } catch (e) {
      set({ isLoading: false });
      throw e;
    }
  },

  logout: async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {}
    set({ user: null, isInitialized: true });
  },

  checkAuth: async () => {
    set({ isLoading: true });
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (res.ok) {
        const user = await res.json();
        set({ user, isLoading: false, isInitialized: true });
      } else {
        set({ user: null, isLoading: false, isInitialized: true });
      }
    } catch {
      set({ user: null, isLoading: false, isInitialized: true });
    }
  },
}));
