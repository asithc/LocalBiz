import { useUiStore } from '../store/uiStore';
import clsx from 'clsx';

export const Toasts = () => {
  const { toasts, dismiss } = useUiStore();

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          onClick={() => dismiss(toast.id)}
          className={clsx(
            'pointer-events-auto rounded-md border px-3 py-2 text-left text-sm shadow-sm',
            toast.type === 'success' && 'border-emerald-300 bg-emerald-50 text-emerald-800',
            toast.type === 'error' && 'border-rose-300 bg-rose-50 text-rose-800',
            toast.type === 'info' && 'border-sky-300 bg-sky-50 text-sky-800'
          )}
        >
          {toast.text}
        </button>
      ))}
    </div>
  );
};
