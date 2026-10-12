// Construye el comando de lanzamiento como array (sin shell, sin concatenar strings).
import path from 'node:path';
import { checkJvmArg } from '../../shared/settings';
import { safeJoin } from './paths';
import { assertSupported, clientJarPath, planLibraries } from './plan';
import { rulesAllow, type RuleContext } from './rules';
import type { ArgPart, VersionJson } from './versionData';

export interface LaunchInput {
  version: VersionJson;
  minecraftDir: string;
  gameDir: string;
  javaPath: string;
  ramMb: number;
  extraJvmArgs: string[];
  resolution: { width: number; height: number } | null;
  session: { name: string; uuid: string; accessToken: string };
  launcherName: string;
  launcherVersion: string;
  ctx: RuleContext;
}
export interface LaunchCommand { command: string; args: string[] }

function expand(parts: ArgPart[], ctx: RuleContext): string[] {
  const out: string[] = [];
  for (const p of parts) {
    if (typeof p === 'string') out.push(p);
    else if (rulesAllow(p.rules, ctx)) out.push(...(Array.isArray(p.value) ? p.value : [p.value]));
  }
  return out;
}

function substitute(arg: string, vars: Record<string, string>): string {
  const res = arg.replace(/\$\{([A-Za-z_]+)\}/g, (m, k: string) => (Object.hasOwn(vars, k) ? vars[k] : m));
  if (/\$\{[^}]*\}/.test(res)) throw new Error(`Argumento de lanzamiento sin resolver: ${arg}`);
  return res;
}

export function buildLaunch(i: LaunchInput): LaunchCommand {
  const v = i.version;
  assertSupported(v, i.ctx);
  const ctx: RuleContext = {
    ...i.ctx,
    features: { ...i.ctx.features, has_custom_resolution: i.resolution !== null, is_demo_user: false }
  };
  for (const a of i.extraJvmArgs) if (!checkJvmArg(a)) throw new Error(`Argumento JVM no permitido: ${a}`);

  const sep = ctx.osName === 'windows' ? ';' : ':';
  const classpath = [...planLibraries(v, i.minecraftDir, ctx).map((s) => s.dest), clientJarPath(i.minecraftDir, v.jarId ?? v.id)].join(sep);
  const nativesDir = safeJoin(i.minecraftDir, 'versions', v.id, 'natives');
  const logPath = v.logging ? safeJoin(i.minecraftDir, 'assets', 'log_configs', v.logging.file.id) : '';

  const vars: Record<string, string> = {
    auth_player_name: i.session.name,
    version_name: v.id,
    game_directory: i.gameDir,
    assets_root: safeJoin(i.minecraftDir, 'assets'),
    assets_index_name: v.assetIndex.id,
    auth_uuid: i.session.uuid,
    auth_access_token: i.session.accessToken,
    clientid: '',
    auth_xuid: '',
    user_type: 'msa',
    version_type: v.type,
    launcher_name: i.launcherName,
    launcher_version: i.launcherVersion,
    classpath,
    classpath_separator: sep,
    natives_directory: nativesDir,
    library_directory: safeJoin(i.minecraftDir, 'libraries'),
    resolution_width: String(i.resolution?.width ?? ''),
    resolution_height: String(i.resolution?.height ?? ''),
    path: logPath
  };

  const jvm = expand(v.arguments!.jvm, ctx).map((a) => substitute(a, vars));
  if (!jvm.some((a) => a === '-cp' || a === '-classpath')) jvm.push('-cp', classpath);
  if (!jvm.some((a) => a.startsWith('-Djava.library.path='))) jvm.push(`-Djava.library.path=${nativesDir}`);
  const logArg = v.logging ? [substitute(v.logging.argument, vars)] : [];
  const game = expand(v.arguments!.game, ctx).map((a) => substitute(a, vars));

  return {
    command: i.javaPath,
    args: [`-Xmx${i.ramMb}M`, ...i.extraJvmArgs, ...jvm, ...logArg, v.mainClass, ...game]
  };
}

export const describeCommand = (c: LaunchCommand): string => `${path.basename(c.command)} ${c.args.join(' ')}`;
