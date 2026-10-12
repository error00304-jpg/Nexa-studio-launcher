import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertFresh, blockReason, checkManifestMatchesEvent, effectiveStatus, parseEventsPayload, sha256Hex, sniffImageType, verifyEnvelope } from '../src/main/events/eventsCore';
import { getBytes } from '../src/main/http';
import type { NexaEvent } from '../src/shared/events';

const HOSTS = ['cdn.example.test'];
const H = 'a'.repeat(64);

function keys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { pub: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), priv: privateKey };
}
const envelope = (obj: unknown, priv: ReturnType<typeof keys>['priv']) => {
  const bytes = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj));
  return JSON.stringify({ alg: 'ed25519', payload: bytes.toString('base64'), signature: sign(null, bytes, priv).toString('base64') });
};
const event = (over: Record<string, unknown> = {}) => ({
  id: 'evento-demo', name: 'Demo', description: 'd', status: 'disponible', serverAddress: 'play.example.com:25565', minecraft: '1.20.1',
  loader: { type: 'forge', version: '47.3.0' },
  modpack: { id: 'demo-pack', version: '1.0.0', manifestUrl: 'https://cdn.example.test/m.json', manifestSha256: H },
  banner: null, news: [], publishedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  requirements: { javaMajor: 17 }, access: { opensAt: null, closesAt: null }, ...over
});
const payload = (events: unknown[] = [event()], over: Record<string, unknown> = {}) => ({
  schema: 1, sequence: 5, issuedAt: '2026-01-01T00:00:00Z', events, news: [], ...over
});
const parse = (p: unknown) => parseEventsPayload(JSON.stringify(p), HOSTS);

describe('firma', () => {
  it('acepta una firma válida y devuelve el contenido', () => {
    const k = keys();
    const text = JSON.stringify(payload());
    expect(verifyEnvelope(envelope(text, k.priv), k.pub)).toBe(text);
  });
  it('rechaza contenido manipulado, otra clave, formato raro o clave inválida', () => {
    const k = keys();
    const env = JSON.parse(envelope(payload(), k.priv));
    env.payload = Buffer.from(JSON.stringify(payload([event({ status: 'mantenimiento' })]))).toString('base64');
    expect(() => verifyEnvelope(JSON.stringify(env), k.pub)).toThrow(/firma/);
    expect(() => verifyEnvelope(envelope(payload(), k.priv), keys().pub)).toThrow(/firma/);
    expect(() => verifyEnvelope(JSON.stringify({ alg: 'rsa', payload: 'x', signature: 'y' }), k.pub)).toThrow(/Formato/);
    expect(() => verifyEnvelope(envelope(payload(), k.priv), 'AAAA')).toThrow(/clave/i);
    expect(() => verifyEnvelope('no es json', k.pub)).toThrow(/JSON/);
  });
});

describe('validación del documento', () => {
  it('acepta un documento válido', () => {
    const p = parse(payload());
    expect(p.events[0].id).toBe('evento-demo');
    expect(p.events[0].serverAddress).toBe('play.example.com:25565');
  });
  it('rechaza datos peligrosos o mal formados', () => {
    const cases: Array<[string, unknown]> = [
      ['manifiesto HTTP', event({ modpack: { ...event().modpack, manifestUrl: 'http://cdn.example.test/m.json' } })],
      ['host no autorizado', event({ modpack: { ...event().modpack, manifestUrl: 'https://evil.example/m.json' } })],
      ['estado inválido', event({ status: 'hackeado' })],
      ['servidor con inyección', event({ serverAddress: 'evil.com;rm -rf /' })],
      ['puerto fuera de rango', event({ serverAddress: 'a.com:99999' })],
      ['hash inválido', event({ modpack: { ...event().modpack, manifestSha256: 'zz' } })],
      ['loader desconocido', event({ loader: { type: 'fabric', version: '1' } })],
      ['id con mayúsculas', event({ id: 'Evento_Malo' })],
      ['noticia enorme', event({ news: [{ id: 'n', title: 't', body: 'x'.repeat(2001), publishedAt: '2026-01-01T00:00:00Z' }] })],
      ['banner de otro host', event({ banner: { url: 'https://evil.example/b.png', sha256: H } })],
      ['fecha inválida', event({ updatedAt: 'ayer' })]
    ];
    for (const [name, ev] of cases) expect(() => parse(payload([ev])), name).toThrow(/inválidos/);
    expect(() => parse(payload([event(), event()]))).toThrow(/duplicado/);
    expect(() => parse({ ...payload(), schema: 2 })).toThrow();
  });
});

describe('frescura y disponibilidad', () => {
  const p = parse(payload([event()], { sequence: 5, expiresAt: '2026-06-01T00:00:00Z' }));
  it('impide reversiones y metadatos caducados', () => {
    expect(() => assertFresh(p, 5, new Date('2026-02-01'))).not.toThrow();
    expect(() => assertFresh(p, 6, new Date('2026-02-01'))).toThrow(/antiguos/);
    expect(() => assertFresh(p, 1, new Date('2026-07-01'))).toThrow(/caducado/);
  });
  it('calcula el estado efectivo y el motivo de bloqueo', () => {
    const e = parse(payload([event({ access: { opensAt: '2026-03-01T00:00:00Z', closesAt: '2026-04-01T00:00:00Z' } })])).events[0];
    expect(effectiveStatus(e, new Date('2026-02-01'))).toBe('proximamente');
    expect(effectiveStatus(e, new Date('2026-03-15'))).toBe('disponible');
    expect(effectiveStatus(e, new Date('2026-05-01'))).toBe('finalizado');
    expect(blockReason(e, new Date('2026-03-15'))).toBeNull();
    expect(blockReason(e, new Date('2026-05-01'))).toContain('finalizado');
    const m = parse(payload([event({ status: 'mantenimiento' })])).events[0];
    expect(blockReason(m, new Date())).toContain('mantenimiento');
  });
  it('el manifiesto debe coincidir con el evento firmado', () => {
    const e: NexaEvent = parse(payload()).events[0];
    const m = { id: 'demo-pack', version: '1.0.0', minecraft: '1.20.1', loader: { type: 'forge', version: '47.3.0', minecraft: '1.20.1', installerSha256: H }, schema: 1, name: 'x', files: [] } as never;
    expect(() => checkManifestMatchesEvent(m, e)).not.toThrow();
    expect(() => checkManifestMatchesEvent({ ...(m as object), version: '9.9.9' } as never, e)).toThrow(/no coincide/);
    expect(() => checkManifestMatchesEvent({ ...(m as object), loader: { type: 'forge', version: '1.0' } } as never, e)).toThrow(/no coincide/);
  });
});

describe('utilidades', () => {
  it('detecta el tipo real de imagen', () => {
    expect(sniffImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0]))).toBe('image/png');
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(Buffer.from('RIFF1234WEBPxxxx'))).toBe('image/webp');
    expect(sniffImageType(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
  });
  it('getBytes respeta límite, HTTPS y estado HTTP', async () => {
    const f = (async () => new Response('x'.repeat(100))) as unknown as typeof fetch;
    expect((await getBytes('https://a.test/x', 1000, f)).length).toBe(100);
    await expect(getBytes('https://a.test/x', 50, f)).rejects.toThrow(/grande/);
    await expect(getBytes('http://a.test/x', 1000, f)).rejects.toThrow(/HTTPS/);
    await expect(getBytes('https://a.test/x', 1000, (async () => new Response('no', { status: 404 })) as unknown as typeof fetch)).rejects.toThrow(/404/);
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('scripts de firma (extremo a extremo)', () => {
  it('keygen + sign-events producen un documento que el launcher acepta', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexa-sign-'));
    try {
      const script = (n: string) => path.resolve(process.cwd(), 'scripts', n);
      execFileSync('node', [script('keygen.mjs'), '--out', path.join(dir, 'k')], { stdio: 'pipe' });
      const pub = (await fs.readFile(path.join(dir, 'k-public.txt'), 'utf8')).trim();
      await fs.writeFile(path.join(dir, 'events.json'), JSON.stringify(payload([event()], { sequence: 7 })));
      execFileSync('node', [script('sign-events.mjs'), '--in', path.join(dir, 'events.json'), '--key', path.join(dir, 'k-private.pem'), '--out', path.join(dir, 'signed.json'), '--valid-days', '30'], { stdio: 'pipe' });
      const parsed = parseEventsPayload(verifyEnvelope(await fs.readFile(path.join(dir, 'signed.json'), 'utf8'), pub), HOSTS);
      expect(parsed.sequence).toBe(7);
      expect(parsed.expiresAt).toBeTruthy();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
