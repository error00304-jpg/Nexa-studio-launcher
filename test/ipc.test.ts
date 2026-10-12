import { describe, it, expect } from 'vitest';
import { isAllowedChannel, isTrustedOrigin, IPC } from '../src/shared/ipc';

describe('IPC', () => {
  it('acepta solo canales declarados', () => {
    expect(isAllowedChannel(IPC.appInfo)).toBe(true);
    expect(isAllowedChannel('fs:read')).toBe(false);
    expect(isAllowedChannel(42)).toBe(false);
  });
  it('valida el origen', () => {
    expect(isTrustedOrigin('file:///app/index.html', null)).toBe(true);
    expect(isTrustedOrigin('https://evil.example', null)).toBe(false);
    expect(isTrustedOrigin('http://localhost:5173/', 'http://localhost:5173')).toBe(true);
    expect(isTrustedOrigin('http://localhost:5173/', null)).toBe(false);
  });
});
