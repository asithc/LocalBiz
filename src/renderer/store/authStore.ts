import { create } from 'zustand';
import type { Session } from '@shared/types';
import { apiRequest } from '../lib/api';

interface AuthState {
  session: Session | null;
  bootstrapped: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
  setSession: (session: Session | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  bootstrapped: false,

  async login(username, password) {
    const session = await apiRequest<Session>('auth/login', { username, password });
    set({ session });
  },

  async logout() {
    await apiRequest('auth/logout');
    set({ session: null });
  },

  async bootstrap() {
    try {
      const session = await apiRequest<Session | null>('auth/session');
      set({ session, bootstrapped: true });
    } catch {
      set({ session: null, bootstrapped: true });
    }
  },

  setSession(session) {
    set({ session });
  }
}));
