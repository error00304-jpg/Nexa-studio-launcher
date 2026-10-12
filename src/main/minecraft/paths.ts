import fs from 'node:fs/promises';
import path from 'node:path';

/** Une rutas garantizando que el resultado quede dentro de `base` (anti path-traversal). */
export function safeJoin(base: string, ...parts: string[]): string {
  if (parts.some((p) => p.includes('\0'))) throw new Error('Ruta inválida.');
  const root = path.resolve(base);
  const full = path.resolve(root, ...parts);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error('Ruta fuera del directorio permitido.');
  return full;
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
