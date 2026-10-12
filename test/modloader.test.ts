import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mergeVersions, parseVersionJson, parseVersionPartial } from '../src/main/minecraft/versionData';
import { buildLaunch } from '../src/main/minecraft/launchArgs';
import { assertSupported, planLibraries } from '../src/main/minecraft/plan';
import { ensureLoader, installerUrl, loaderVersionId, validateLoader, type LoaderSpec } from '../src/main/minecraft/loaderInstaller';
import type { RuleContext } from '../src/main/minecraft/rules';

const win: RuleContext = { osName: 'windows', arch: 'x86_64', osVersion: '10.0.22631', features: {} };
const sha = 'a'.repeat(40);
const art = (p: string) => ({ path: p, url: `https://libraries.minecraft.net/${p}`, sha1: sha, size: 10 });

const parentRaw = {
  id: '1.99', type: 'release', mainClass: 'net.minecraft.client.main.Main', javaVersion: { majorVersion: 17 },
  assetIndex: { id: '99', url: 'https://piston-meta.mojang.com/i.json', sha1: sha, size: 5 },
  downloads: { client: { url: 'https://piston-data.mojang.com/c.jar', sha1: sha, size: 7 } },
  libraries: [{ name: 'a:a:1', downloads: { artifact: art('a/a/1/a-1.jar') } }],
  arguments: {
    jvm: ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'],
    game: ['--username', '${auth_player_name}', '--version', '${version_name}', '--gameDir', '${game_directory}', '--accessToken', '${auth_access_token}']
  }
};
const childRaw = {
  id: '1.99-forge-1.0', type: 'release', inheritsFrom: '1.99', mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher',
  libraries: [
    { name: 'a:a:2', downloads: { artifact: art('a/a/2/a-2.jar') } },
    { name: 'net.minecraftforge:forge:1.99-1.0:client', downloads: { artifact: { path: 'net/minecraftforge/forge/1.99-1.0/forge-1.99-1.0-client.jar', url: '', sha1: sha, size: 5 } } }
  ],
  arguments: {
    game: ['--launchTarget', 'forgeclient'],
    jvm: ['-DlibraryDirectory=${library_directory}', '-p', '${library_directory}/x.jar${classpath_separator}${library_directory}/y.jar', '--add-modules', 'ALL-MODULE-PATH']
  }
};

describe('herencia de versiones (Forge)', () => {
  const merged = mergeVersions(parseVersionJson(parentRaw), parseVersionPartial(childRaw));

  it('fusiona bibliotecas (el hijo sustituye versiones) y conserva datos del padre', () => {
    expect(merged.libraries.map((l) => l.name)).toEqual(['a:a:2', 'net.minecraftforge:forge:1.99-1.0:client']);
    expect(merged.mainClass).toBe('cpw.mods.bootstraplauncher.BootstrapLauncher');
    expect(merged.id).toBe('1.99-forge-1.0');
    expect(merged.jarId).toBe('1.99');
    expect(merged.javaMajor).toBe(17);
    expect(merged.assetIndex.id).toBe('99');
    expect(() => assertSupported(merged, win)).not.toThrow();
  });
  it('los archivos generados por el instalador no tienen URL', () => {
    const specs = planLibraries(merged, path.resolve('/tmp/mc'), win);
    expect(specs[1].url).toBe('');
  });
  it('construye el lanzamiento: argumentos del padre primero, módulos de Forge y jar del padre', () => {
    const { args } = buildLaunch({
      version: merged, minecraftDir: path.resolve('/tmp/mc'), gameDir: path.resolve('/tmp/mc/instances/x'), javaPath: 'java',
      ramMb: 4096, extraJvmArgs: [], resolution: null, session: { name: 'Steve', uuid: '0123456789abcdef0123456789abcdef', accessToken: 'T' },
      launcherName: 'NexaStudios', launcherVersion: '0.1.0', ctx: win
    });
    expect(args.some((a) => a.includes('${'))).toBe(false);
    expect(args.indexOf('-cp')).toBeLessThan(args.indexOf('-DlibraryDirectory=' + path.resolve('/tmp/mc/libraries')));
    expect(args.find((a) => a.includes('x.jar'))).toContain(';');
    expect(args[args.indexOf('-cp') + 1]).toContain(path.join('versions', '1.99', '1.99.jar'));
    expect(args).toContain('--launchTarget');
    expect(args.indexOf('cpw.mods.bootstraplauncher.BootstrapLauncher')).toBeLessThan(args.indexOf('--username'));
  });
});

describe('modloader', () => {
  const forge: LoaderSpec = { type: 'forge', version: '47.3.0', minecraft: '1.20.1', installerSha256: 'b'.repeat(64) };
  it('calcula id y URL del instalador', () => {
    expect(loaderVersionId(forge)).toBe('1.20.1-forge-47.3.0');
    expect(installerUrl(forge)).toBe('https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.3.0/forge-1.20.1-47.3.0-installer.jar');
    expect(loaderVersionId({ ...forge, type: 'neoforge', version: '21.1.5' })).toBe('neoforge-21.1.5');
  });
  it('valida los datos', () => {
    expect(() => validateLoader({ ...forge, version: '../x' })).toThrow();
    expect(() => validateLoader({ ...forge, installerSha256: 'abc' })).toThrow();
    expect(() => validateLoader({ ...forge, type: 'otro' as never })).toThrow();
  });

  let tmp = '';
  beforeAll(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'nexa-l-')); });
  afterAll(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it('descarga el instalador verificado, lo ejecuta una vez y devuelve el id', async () => {
    const jar = Buffer.from('FAKE-INSTALLER');
    const spec = { ...forge, installerSha256: createHash('sha256').update(jar).digest('hex') };
    const fetchImpl = vi.fn(async () => new Response(jar));
    const calls: Array<{ command: string; args: string[] }> = [];
    const run = vi.fn((cmd: { command: string; args: string[] }, _cwd: string, hooks: { onExit(c: number): void }) => {
      calls.push(cmd);
      void fs.mkdir(path.join(tmp, 'versions', '1.20.1-forge-47.3.0'), { recursive: true })
        .then(() => fs.writeFile(path.join(tmp, 'versions', '1.20.1-forge-47.3.0', '1.20.1-forge-47.3.0.json'), '{}'))
        .then(() => hooks.onExit(0));
      return { kill() {} };
    });
    const o = { minecraftDir: tmp, javaPath: 'java', force: false, onLine: () => {}, download: { fetchImpl: fetchImpl as unknown as typeof fetch, retries: 0 }, run: run as never };

    expect(await ensureLoader(spec, o)).toBe('1.20.1-forge-47.3.0');
    expect(calls[0].args[0]).toBe('-jar');
    expect(calls[0].args.slice(2)).toEqual(['--installClient', tmp]);
    await expect(fs.access(path.join(tmp, 'launcher_profiles.json'))).resolves.toBeUndefined();

    await ensureLoader(spec, o); // ya instalado: no vuelve a ejecutar
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('rechaza un instalador con hash distinto', async () => {
    const o = {
      minecraftDir: await fs.mkdtemp(path.join(os.tmpdir(), 'nexa-l2-')), javaPath: 'java', force: false, onLine: () => {},
      download: { fetchImpl: (async () => new Response('otro')) as unknown as typeof fetch, retries: 0 }
    };
    await expect(ensureLoader(forge, o)).rejects.toThrow(/SHA-256/);
    await fs.rm(o.minecraftDir, { recursive: true, force: true });
  });
});
