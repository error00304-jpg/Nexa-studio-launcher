import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { downloadFile } from '../src/main/minecraft/downloader';
import { installVersion } from '../src/main/minecraft/installer';
import { currentContext } from '../src/main/minecraft/rules';

const sha1 = (b: Buffer | string) => createHash('sha1').update(b).digest('hex');
const HOSTS = ['example.test', 'resources.download.minecraft.net'];
let tmp = '';
beforeAll(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'nexa-')); });
afterAll(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

describe('downloadFile', () => {
  it('descarga, verifica y omite si ya es válido', async () => {
    const body = Buffer.from('contenido');
    const f = vi.fn(async () => new Response(body));
    const spec = { url: 'https://example.test/a.bin', dest: path.join(tmp, 'a.bin'), sha1: sha1(body), size: body.length };
    const o = { fetchImpl: f as unknown as typeof fetch, allowedHosts: HOSTS, retries: 0 };
    expect(await downloadFile(spec, o)).toBe('downloaded');
    expect(await downloadFile(spec, o)).toBe('skipped');
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('rechaza hash incorrecto y no deja archivos', async () => {
    const f = vi.fn(async () => new Response('otro contenido'));
    const dest = path.join(tmp, 'b.bin');
    await expect(downloadFile({ url: 'https://example.test/b', dest, sha1: sha1('esperado') },
      { fetchImpl: f as unknown as typeof fetch, allowedHosts: HOSTS, retries: 1, baseDelayMs: 0 })).rejects.toThrow(/SHA-1/);
    expect(f).toHaveBeenCalledTimes(2);
    await expect(fs.access(dest)).rejects.toBeTruthy();
    await expect(fs.access(`${dest}.part`)).rejects.toBeTruthy();
  });
  it('rechaza hosts no autorizados y HTTP', async () => {
    await expect(downloadFile({ url: 'https://evil.example/x', dest: path.join(tmp, 'c') }, { allowedHosts: HOSTS })).rejects.toThrow(/no autorizado/);
    await expect(downloadFile({ url: 'http://example.test/x', dest: path.join(tmp, 'd') }, { allowedHosts: HOSTS })).rejects.toThrow(/no autorizado/);
  });
});

describe('installVersion (integración con servidor simulado)', () => {
  it('instala, es idempotente y repara archivos truncados', async () => {
    const files = new Map<string, Buffer>();
    const add = (url: string, content: string) => { const b = Buffer.from(content); files.set(url, b); return { url, sha1: sha1(b), size: b.length }; };
    const lib = add('https://example.test/lib.jar', 'LIBDATA');
    const client = add('https://example.test/client.jar', 'CLIENT');
    const aObj = 'hello-asset';
    const aHash = sha1(aObj);
    files.set(`https://resources.download.minecraft.net/${aHash.slice(0, 2)}/${aHash}`, Buffer.from(aObj));
    const idx = add('https://example.test/idx.json', JSON.stringify({ objects: { 'icons/a.png': { hash: aHash, size: aObj.length } } }));

    const version = {
      id: '1.99', type: 'release', mainClass: 'Main', assetIndex: { id: '99', ...idx }, downloads: { client },
      libraries: [{ name: 'x:y:1', downloads: { artifact: { path: 'x/y/1/y-1.jar', ...lib } } }],
      arguments: { game: [], jvm: [] }
    };
    const vdir = path.join(tmp, 'versions', '1.99');
    await fs.mkdir(vdir, { recursive: true });
    await fs.writeFile(path.join(vdir, '1.99.json'), JSON.stringify(version));

    const f = vi.fn(async (url: string) => {
      const b = files.get(String(url));
      return b ? new Response(b) : new Response('no', { status: 404 });
    });
    const phases: string[] = [];
    const opts = {
      versionId: '1.99', minecraftDir: tmp, concurrency: 2, quick: true, ctx: currentContext(),
      onProgress: (p: { phase: string }) => phases.push(p.phase),
      download: { fetchImpl: f as unknown as typeof fetch, allowedHosts: HOSTS, retries: 0 }
    };

    await installVersion(opts);
    for (const p of ['libraries/x/y/1/y-1.jar', 'versions/1.99/1.99.jar', 'assets/indexes/99.json', `assets/objects/${aHash.slice(0, 2)}/${aHash}`]) {
      await expect(fs.access(path.join(tmp, p))).resolves.toBeUndefined();
    }
    expect(phases).toContain('listo');
    expect(f).toHaveBeenCalledTimes(4);

    await installVersion(opts);
    expect(f).toHaveBeenCalledTimes(4); // nada que descargar

    await fs.writeFile(path.join(tmp, 'libraries/x/y/1/y-1.jar'), 'xx'); // tamaño incorrecto
    await installVersion(opts);
    expect(f).toHaveBeenCalledTimes(5);
    expect((await fs.readFile(path.join(tmp, 'libraries/x/y/1/y-1.jar'))).toString()).toBe('LIBDATA');
  });
});
