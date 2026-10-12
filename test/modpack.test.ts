import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installModpack, instanceDir, parseModpackManifest, readState } from '../src/main/minecraft/modpack';

const HOSTS = ['cdn.example.test'];
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const loader = { type: 'forge', version: '47.3.0', installerSha256: 'c'.repeat(64) };
const file = (p: string, content: string, extra: object = {}) => ({ path: p, url: `https://cdn.example.test/${p}`, sha256: sha256(content), size: Buffer.byteLength(content), ...extra });
const manifest = (version: string, files: object[]) => ({ schema: 1, id: 'demo-pack', name: 'Demo', version, minecraft: '1.20.1', loader, files });

describe('parseModpackManifest', () => {
  const ok = () => manifest('1.0.0', [file('mods/a.jar', 'A')]);
  it('acepta un manifiesto válido y asigna políticas por defecto', () => {
    const m = parseModpackManifest(manifest('1.0.0', [file('mods/a.jar', 'A'), file('config/x.toml', 'X')]), HOSTS);
    expect(m.files.map((f) => f.policy)).toEqual(['enforce', 'initial']);
  });
  it('rechaza rutas peligrosas o carpetas no permitidas', () => {
    for (const p of ['../evil.jar', 'mods/../../x.jar', '/etc/passwd', 'mods\\a.jar', 'saves/world/level.dat', 'mods/readme.txt', 'C:/x.jar', 'mods//a.jar', 'mods']) {
      expect(() => parseModpackManifest(manifest('1', [file(p, 'A')]), HOSTS), p).toThrow();
    }
  });
  it('rechaza hosts no autorizados, HTTP, hashes inválidos y duplicados', () => {
    expect(() => parseModpackManifest(manifest('1', [file('mods/a.jar', 'A', { url: 'https://evil.example/a.jar' })]), HOSTS)).toThrow(/no autorizado/);
    expect(() => parseModpackManifest(manifest('1', [file('mods/a.jar', 'A', { url: 'http://cdn.example.test/a.jar' })]), HOSTS)).toThrow(/HTTPS/);
    expect(() => parseModpackManifest(manifest('1', [file('mods/a.jar', 'A', { sha256: 'xyz' })]), HOSTS)).toThrow(/sha256/);
    expect(() => parseModpackManifest(manifest('1', [file('mods/a.jar', 'A'), file('mods/A.jar', 'A')]), HOSTS)).toThrow(/duplicada/);
  });
  it('exige hosts configurados y un instalador con SHA-256', () => {
    expect(() => parseModpackManifest(ok(), [])).toThrow(/modpackHosts/);
    expect(() => parseModpackManifest({ ...ok(), loader: { ...loader, installerSha256: '1' } }, HOSTS)).toThrow();
  });
});

describe('installModpack', () => {
  let tmp = '';
  beforeAll(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'nexa-p-')); });
  afterAll(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it('instala, es idempotente, respeta configuración y mundos, y limpia mods viejos', async () => {
    const contents: Record<string, string> = { 'mods/a.jar': 'AAAA', 'mods/b.jar': 'BBBB', 'config/x.toml': 'cfg=1' };
    const fetchImpl = vi.fn(async (url: string) => {
      const key = String(url).replace('https://cdn.example.test/', '');
      return key in contents ? new Response(contents[key]) : new Response('no', { status: 404 });
    });
    const base = { minecraftDir: tmp, concurrency: 2, quick: false, allowedHosts: HOSTS, download: { fetchImpl: fetchImpl as unknown as typeof fetch, retries: 0 } };
    const m1 = parseModpackManifest(manifest('1.0.0', Object.entries(contents).map(([p, c]) => file(p, c))), HOSTS);
    const inst = instanceDir(tmp, 'demo-pack');

    await installModpack(m1, base);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect((await readState(inst))?.version).toBe('1.0.0');

    await installModpack(m1, base); // nada cambió
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    // El jugador edita su config, crea un mundo y un mod propio; un mod del pack se corrompe (mismo tamaño)
    await fs.writeFile(path.join(inst, 'config/x.toml'), 'cfg=PERSONAL');
    await fs.mkdir(path.join(inst, 'saves/mundo'), { recursive: true });
    await fs.writeFile(path.join(inst, 'saves/mundo/level.dat'), 'MUNDO');
    await fs.writeFile(path.join(inst, 'mods/propio.jar'), 'MIO');
    await fs.writeFile(path.join(inst, 'mods/a.jar'), 'ZZZZ');

    // v2: se elimina b.jar del pack
    const m2 = parseModpackManifest(manifest('1.1.0', [file('mods/a.jar', 'AAAA'), file('config/x.toml', 'cfg=1')]), HOSTS);
    await installModpack(m2, base);

    expect(await fs.readFile(path.join(inst, 'mods/a.jar'), 'utf8')).toBe('AAAA');               // reparado
    expect(await fs.readFile(path.join(inst, 'config/x.toml'), 'utf8')).toBe('cfg=PERSONAL');    // respetado
    await expect(fs.access(path.join(inst, 'mods/b.jar'))).rejects.toBeTruthy();                  // mod retirado
    expect(await fs.readFile(path.join(inst, 'mods/propio.jar'), 'utf8')).toBe('MIO');           // no es del pack
    expect(await fs.readFile(path.join(inst, 'saves/mundo/level.dat'), 'utf8')).toBe('MUNDO');   // intacto
    expect((await readState(inst))?.version).toBe('1.1.0');
  });

  it('ignora entradas manipuladas del estado al limpiar', async () => {
    const inst = instanceDir(tmp, 'demo-pack');
    await fs.mkdir(path.join(inst, 'saves'), { recursive: true });
    await fs.writeFile(path.join(inst, 'saves/importante.dat'), 'X');
    await fs.writeFile(path.join(inst, 'nexa-instance.json'), JSON.stringify({ manifestId: 'demo-pack', version: '1', files: ['saves/importante.dat', '../../fuera.txt'] }));
    const fetchImpl = vi.fn(async () => new Response('AAAA'));
    const m = parseModpackManifest(manifest('2', [file('mods/a.jar', 'AAAA')]), HOSTS);
    await installModpack(m, { minecraftDir: tmp, concurrency: 1, quick: false, allowedHosts: HOSTS, download: { fetchImpl: fetchImpl as unknown as typeof fetch, retries: 0 } });
    expect(await fs.readFile(path.join(inst, 'saves/importante.dat'), 'utf8')).toBe('X');
  });

  it('al cambiar de versión verifica hashes aunque el modo sea rápido (mismo tamaño, otro contenido)', async () => {
    const contents: Record<string, string> = { 'mods/a.jar': 'AAAA' };
    const fetchImpl = vi.fn(async (url: string) => new Response(contents[String(url).replace('https://cdn.example.test/', '')] ?? ''));
    const o = { minecraftDir: tmp, concurrency: 1, quick: true, allowedHosts: HOSTS, download: { fetchImpl: fetchImpl as unknown as typeof fetch, retries: 0 } };
    const v1 = { ...manifest('1.0.0', [file('mods/a.jar', 'AAAA')]), id: 'pack-dos' };
    await installModpack(parseModpackManifest(v1, HOSTS), o);
    contents['mods/a.jar'] = 'BBBB';
    const v2 = { ...manifest('1.0.1', [file('mods/a.jar', 'BBBB')]), id: 'pack-dos' };
    await installModpack(parseModpackManifest(v2, HOSTS), o);
    expect(await fs.readFile(path.join(instanceDir(tmp, 'pack-dos'), 'mods/a.jar'), 'utf8')).toBe('BBBB');
  });
});
