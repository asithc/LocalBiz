import type { ApiResponse } from '@shared/types';

export const apiRequest = async <T = unknown>(route: string, payload?: unknown): Promise<T> => {
  const res: ApiResponse<T> = await window.api.request<T>(route, payload);
  if (!res.ok) {
    throw new Error(res.error || 'Request failed');
  }
  return res.data as T;
};

export const exportModule = (module: string, format: 'xlsx' | 'csv') =>
  apiRequest<{ canceled: boolean; filePath?: string }>('export/run', { module, format });
