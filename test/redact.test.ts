import { describe, it, expect } from 'vitest';
import { redact } from '../src/shared/redact';

describe('redact', () => {
  it('oculta tokens Bearer', () => {
    expect(redact('Authorization: Bearer abc.def-123')).not.toContain('abc.def');
  });
  it('oculta access_token en JSON y argumentos', () => {
    expect(redact('{"access_token":"SECRETO","x":1}')).not.toContain('SECRETO');
    expect(redact('--accessToken SECRETO --username a')).not.toContain('SECRETO');
  });
  it('conserva texto normal', () => {
    expect(redact('Descarga completada: 12 archivos')).toBe('Descarga completada: 12 archivos');
  });
});
