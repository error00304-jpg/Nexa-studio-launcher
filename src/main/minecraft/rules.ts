import os from 'node:os';

export interface Rule {
  action: 'allow' | 'disallow';
  os?: { name?: string; arch?: string; version?: string };
  features?: Record<string, boolean>;
}
export interface RuleContext {
  osName: string;
  arch: string;
  osVersion: string;
  features: Record<string, boolean>;
}

export function currentContext(features: Record<string, boolean> = {}): RuleContext {
  const osName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
  const arch = process.arch === 'ia32' ? 'x86' : process.arch === 'x64' ? 'x86_64' : process.arch;
  return { osName, arch, osVersion: os.release(), features };
}

function matches(r: Rule, ctx: RuleContext): boolean {
  if (r.os) {
    if (r.os.name && r.os.name !== ctx.osName) return false;
    if (r.os.arch && r.os.arch !== ctx.arch) return false;
    if (r.os.version) {
      try {
        if (!new RegExp(r.os.version).test(ctx.osVersion)) return false;
      } catch {
        return false;
      }
    }
  }
  if (r.features) {
    for (const [k, v] of Object.entries(r.features)) if ((ctx.features[k] ?? false) !== v) return false;
  }
  return true;
}

/** Sin reglas = permitido. Con reglas: por defecto denegado; gana la última regla que coincide. */
export function rulesAllow(rules: Rule[] | undefined, ctx: RuleContext): boolean {
  if (!rules || rules.length === 0) return true;
  let allowed = false;
  for (const r of rules) if (matches(r, ctx)) allowed = r.action === 'allow';
  return allowed;
}
