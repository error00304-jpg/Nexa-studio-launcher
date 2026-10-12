import { redact } from '../shared/redact';
import type { LogEntry } from '../shared/ipc';

const MAX_ENTRIES = 500;
const entries: LogEntry[] = [];

function push(level: LogEntry['level'], message: string): void {
  entries.push({ time: new Date().toISOString(), level, message: redact(message) });
  if (entries.length > MAX_ENTRIES) entries.shift();
}

export const log = {
  info: (m: string) => push('info', m),
  warn: (m: string) => push('warn', m),
  error: (m: string) => push('error', m)
};

export function getLogs(): LogEntry[] {
  return [...entries];
}
