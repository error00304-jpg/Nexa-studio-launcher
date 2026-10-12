import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { rulesAllow, type RuleContext } from '../src/main/minecraft/rules';
import { parseVersionJson } from '../src/main/minecraft/versionData';
import { buildLaunch } from '../src/main/minecraft/launchArgs';
import { assertSupported, planLibraries } from '../src/main/minecraft/plan';
import { safeJoin } from '../src/main/minecraft/paths';
import { redact } from '../src/shared/redact';

const win: RuleContext = { osName: 'windows', arch: 'x86_64', osVersion: '10.0.22631', features: {} };
const sha = 'a'.repeat(40);
const art = (p: string) => ({ path: p, url: `https://libraries.minecraft.net/${p}`, sha1: sha, size: 10 });

const raw = () => ({
  id: '1.99', type: 'release', mainClass: 'net.minecraft.client.main.Main',
  assetIndex: { id: '99', url: 'https://piston-meta.mojang.com/i.json', sha1: sha, size: 5 },
  downloads: { client: { url: 'https://piston-data.mojang.com/c.jar', sha1: sha, size: 7 } },
  javaVersion: { majorVersion: 21 },
  libraries: [
    { name: 'a:a:1', downloads: { artifact: art('a/a/1/a-1.jar') } },
    { name: 'l:l:1:natives-windows', rules: [{ action: 'allow', os: { name: 'windows' } }], downloads: { artifact: art('l/l/1/l-1-natives-windows.jar') } },
    { name: 'l:l:1:natives-linux', rules: [{ action: 'allow', os: { name: 'linux' } }], downloads: { artifact: art('l/l/1/l-1-natives-linux.jar') } }
  ],
  arguments: {
    jvm: ['-Djava.library.path=${natives_directory}', { rules: [{ action: 'allow', os: { name: 'osx' } }], value: '-XstartOnFirstThread' }, '-cp', '${classpath}'],
    game: ['--username', '${auth_player_name}', '--version', '${version_name}', '--gameDir', '${game_directory}',
      '--assetsDir', '${assets_root}', '--assetIndex', '${assets_index_name}', '--uuid', '${auth_uuid}',
      '--accessToken', '${auth_access_token}', '--userType', '${user_type}',
      { rules: [{ action: 'allow', features: { has_custom_resolution: true } }], value: ['--width', '${resolution_width}', '--height', '${resolution_height}'] }]
  }
});

const input = (over: object = {}) => ({
  version: parseVersionJson(raw()), minecraftDir: path.resolve('/tmp/mc'), gameDir: path.resolve('/tmp/mc/instances/x'),
  javaPath: 'java', ramMb: 4096, extraJvmArgs: [], resolution: { width: 1280, height: 720 },
  session: { name: 'Steve', uuid: '0123456789abcdef0123456789abcdef', accessToken: 'SECRETTOKEN' },
  launcherName: 'NexaStudios', launcherVersion: '0.1.0', ctx: win, ...over
});

describe('rulesAllow', () => {
  it('sin reglas permite; con reglas gana la última coincidente', () => {
    expect(rulesAllow(undefined, win)).toBe(true);
    expect(rulesAllow([{ action: 'allow' }, { action: 'disallow', os: { name: 'windows' } }], win)).toBe(false);
    expect(rulesAllow([{ action: 'allow', os: { name: 'linux' } }], win)).toBe(false);
    expect(rulesAllow([{ action: 'allow', features: { has_custom_resolution: true } }], win)).toBe(false);
  });
});

describe('plan y lanzamiento', () => {
  it('filtra bibliotecas por sistema operativo', () => {
    const libs = planLibraries(parseVersionJson(raw()), path.resolve('/tmp/mc'), win);
    expect(libs.map((l) => path.basename(l.dest))).toEqual(['a-1.jar', 'l-1-natives-windows.jar']);
  });
  it('construye argumentos sin placeholders sin resolver', () => {
    const { args } = buildLaunch(input());
    expect(args.some((a) => a.includes('${'))).toBe(false);
    expect(args[0]).toBe('-Xmx4096M');
    expect(args).toContain('--width');
    expect(args.indexOf('net.minecraft.client.main.Main')).toBeLessThan(args.indexOf('--username'));
    expect(args).not.toContain('-XstartOnFirstThread');
  });
  it('omite la resolución si no se define y rechaza JVM args peligrosos', () => {
    expect(buildLaunch(input({ resolution: null })).args).not.toContain('--width');
    expect(() => buildLaunch(input({ extraJvmArgs: ['-javaagent:x.jar'] }))).toThrow(/no permitido/);
  });
  it('el token no queda visible tras redactar el comando', () => {
    const line = buildLaunch(input()).args.join(' ');
    expect(line).toContain('SECRETTOKEN');
    expect(redact(line)).not.toContain('SECRETTOKEN');
  });
  it('detecta versiones no soportadas', () => {
    const r = raw();
    (r.libraries[0] as Record<string, unknown>).natives = { windows: 'natives-windows' };
    expect(() => assertSupported(parseVersionJson(r), win)).toThrow(/nativas/);
    const legacy = raw() as Record<string, unknown>;
    delete legacy.arguments;
    expect(() => assertSupported(parseVersionJson(legacy), win)).toThrow(/formato antiguo/);
  });
  it('rechaza metadatos inválidos', () => {
    expect(() => parseVersionJson({ ...raw(), id: '../x' })).toThrow();
    const r = raw();
    r.assetIndex.sha1 = 'zz';
    expect(() => parseVersionJson(r)).toThrow();
  });
});

describe('safeJoin', () => {
  it('impide salir del directorio base', () => {
    const base = path.resolve('/tmp/mc');
    expect(safeJoin(base, 'libraries', 'a/b.jar')).toBe(path.join(base, 'libraries', 'a', 'b.jar'));
    expect(() => safeJoin(base, '../etc/passwd')).toThrow();
    expect(() => safeJoin(base, '/etc/passwd')).toThrow();
    expect(() => safeJoin(base, 'a\0b')).toThrow();
  });
});
