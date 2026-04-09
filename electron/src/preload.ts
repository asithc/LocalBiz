import { contextBridge, ipcRenderer } from 'electron';
import type { ApiRequest, ApiResponse } from '../../src/shared/types';

const api = {
  request: async <T = unknown>(route: string, payload?: unknown) => {
    const req: ApiRequest = { route, payload };
    return ipcRenderer.invoke('api:request', req) as Promise<ApiResponse<T>>;
  }
};

contextBridge.exposeInMainWorld('api', api);

declare global {
  interface Window {
    api: typeof api;
  }
}
