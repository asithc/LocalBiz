import { create } from 'zustand';

export interface ToastMessage {
  id: number;
  type: 'success' | 'error' | 'info';
  text: string;
}

interface UiState {
  toasts: ToastMessage[];
  notify: (type: ToastMessage['type'], text: string) => void;
  dismiss: (id: number) => void;
}

let toastId = 1;

export const useUiStore = create<UiState>((set) => ({
  toasts: [],

  notify(type, text) {
    const id = toastId++;
    set((state) => ({ toasts: [...state.toasts, { id, type, text }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 3500);
  },

  dismiss(id) {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  }
}));
