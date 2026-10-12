import type { NexaApi } from '../shared/ipc';
declare global {
  interface Window {
    nexa: NexaApi;
  }
}
export {};
