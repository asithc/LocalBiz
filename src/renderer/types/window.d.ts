import type { ApiResponse } from '@shared/types';

declare global {
  interface Window {
    api: {
      request<T = unknown>(route: string, payload?: unknown): Promise<ApiResponse<T>>;
    };
  }
}

export {};
