import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface JavaInfo { path: string; version: string; major: number }

export function parseJavaVersion(output: string): { version: string; major: number } | null {
  const m = /version "([^"]+)"/.exec(output);
  if (!m) return null;
  const parts = m[1].split(/[._-]/);
  let major = parseInt(parts[0], 10);
  if (major === 1) major = parseInt(parts[1], 10); // 1.8.0_xx => 8
  return Number.isFinite(major) ? { version: m[1], major } : null;
}

function run(file: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, ['-version'], { timeout: 8000, windowsHide: true }, (err, stdout, stderr) =>
      resolve(err ? '' : `${stdout}\n${stderr}`)
    );
  });
}

async function probe(file: string): Promise<JavaInfo | null> {
  const parsed = parseJavaVersion(await run(file));
  return parsed ? { path: file, ...parsed } : null;
}

async function candidates(): Promise<string[]> {
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  const list: string[] = [];
  if (process.env.JAVA_HOME) list.push(path.join(process.env.JAVA_HOME, 'bin', exe));
  list.push(exe); // PATH
  const roots: string[] = [];
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
    for (const r of ['Java', 'Eclipse Adoptium', 'Microsoft', 'Zulu', 'Amazon Corretto', 'BellSoft', 'Semeru']) roots.push(path.join(pf, r));
  } else {
    roots.push('/usr/lib/jvm');
  }
  for (const root of roots) {
    try {
      for (const e of await fs.readdir(root)) list.push(path.join(root, e, 'bin', exe));
    } catch {
      /* no existe */
    }
  }
  return [...new Set(list)];
}

export async function findJava(required: number, configured: string): Promise<JavaInfo> {
  if (configured) {
    const info = await probe(configured);
    if (!info) throw new Error('La ruta de Java indicada en Ajustes no funciona.');
    if (info.major < required) throw new Error(`Se requiere Java ${required} o superior; la ruta de Ajustes es Java ${info.major}.`);
    return info;
  }
  const found: JavaInfo[] = [];
  for (const c of await candidates()) {
    const info = await probe(c);
    if (info && !found.some((f) => f.version === info.version && f.path === info.path)) found.push(info);
  }
  const ok = found.filter((f) => f.major >= required).sort((a, b) => a.major - b.major)[0];
  if (ok) return ok;
  const have = found.length ? ` Encontradas: ${found.map((f) => `Java ${f.major}`).join(', ')}.` : ' No se encontró ninguna.';
  throw new Error(`Se requiere Java ${required} o superior.${have} Instálala (p. ej. Eclipse Adoptium) o indica la ruta en Ajustes.`);
}
