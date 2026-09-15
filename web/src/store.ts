import { create } from 'zustand';
import { api, setToken, getToken } from './api';
import type { Bootstrap, Meta, User } from './types';

export interface Toast { id: number; msg: string; kind: 'ok' | 'err' }
export interface BookingIntent { patientId: string; equipmentId?: string }

interface Store {
  user: User | null;
  meta: Meta | null;
  data: Bootstrap | null;
  loading: boolean;
  toasts: Toast[];
  bookingIntent: BookingIntent | null;
  init: () => Promise<void>;
  login: (u: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  call: (fn: () => Promise<unknown>, okMsg?: string) => Promise<boolean>;
  toast: (msg: string, kind?: 'ok' | 'err') => void;
  dismissToast: (id: number) => void;
  setBookingIntent: (i: BookingIntent | null) => void;
}

export const useStore = create<Store>((set, get) => ({
  user: null,
  meta: null,
  data: null,
  loading: true,
  toasts: [],
  bookingIntent: null,

  async init() {
    try {
      const meta = await api<Meta>('/meta');
      set({ meta });
      if (getToken()) {
        const me = await api<{ user: User }>('/auth/me');
        set({ user: me.user });
        await get().reload();
      }
    } catch {
      setToken(null);
    } finally {
      set({ loading: false });
    }
  },

  async login(u, p) {
    const r = await api<{ token: string; user: User }>('/auth/login', { body: { username: u, password: p } });
    setToken(r.token);
    set({ user: r.user });
    await get().reload();
  },

  async logout() {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* 忽略 */ }
    setToken(null);
    set({ user: null, data: null });
  },

  async reload() {
    const data = await api<Bootstrap>('/bootstrap');
    set({ data });
  },

  async call(fn, okMsg) {
    try {
      await fn();
      await get().reload();
      if (okMsg) get().toast(okMsg, 'ok');
      return true;
    } catch (e: any) {
      get().toast(e.message || '操作失败', 'err');
      return false;
    }
  },

  toast(msg, kind = 'ok') {
    const id = Date.now() + Math.random();
    set((s) => ({ toasts: [...s.toasts, { id, msg, kind }] }));
    setTimeout(() => get().dismissToast(id), 3600);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  setBookingIntent(i) {
    set({ bookingIntent: i });
  },
}));
