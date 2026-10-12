#!/usr/bin/env node
// Genera el manifiesto de un modpack a partir de una carpeta local (con mods/, config/, ...).
// Uso: node scripts/make-manifest.mjs --dir ./pack --base-url https://cdn.ejemplo.com/pack/ --id nexa-evento1 \
//        --name "Evento 1" --version 1.0.0 --minecraft 1.20.1 --loader forge --loader-version 47.3.0 \
//        --installer ./forge-1.20.1-47.3.0-installer.jar [--out manifest.json]
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MANAGED = ['mods', 'config', 'defaultconfigs', 'resourcepacks', 'shaderpacks', 'kubejs', 'scripts'];
const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1];

const need = ['dir', 'base-url', 'id', 'name', 'version', 'minecraft', 'loader', 'loader-version'];
const missing = need.filter((k) => !args[k]);
if (missing.length || !(args.installer || args['installer-sha256'])) {
  console.error(`Faltan argumentos: ${[...missing, ...(args.installer || args['installer-sha256'] ? [] : ['installer | installer-sha256'])].join(', ')}`);
  process.exit(1);
}

async function sha256(file) {
  const h = createHash('sha256');
  for await (const c of createReadStream(file)) h.update(c);
  return h.digest('hex');
}
async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

const base = args['base-url'].endsWith('/') ? args['base-url'] : `${args['base-url']}/`;
const files = [];
for (const d of MANAGED) {
  const root = path.join(args.dir, d);
  try { await stat(root); } catch { continue; }
  for await (const f of walk(root)) {
    const rel = path.relative(args.dir, f).split(path.sep).join('/');
    if (d === 'mods' && !rel.endsWith('.jar')) continue;
    files.push({ path: rel, url: base + rel.split('/').map(encodeURIComponent).join('/'), sha256: await sha256(f), size: (await stat(f)).size });
  }
}
files.sort((a, b) => a.path.localeCompare(b.path));

const manifest = {
  schema: 1, id: args.id, name: args.name, version: args.version, minecraft: args.minecraft,
  loader: { type: args.loader, version: args['loader-version'], installerSha256: args['installer-sha256'] ?? await sha256(args.installer) },
  files
};
const out = JSON.stringify(manifest, null, 2);
if (args.out) await writeFile(args.out, out); else console.log(out);
console.error(`SHA-256 del manifiesto (úsalo como manifestSha256 en el evento): ${createHash('sha256').update(out).digest('hex')}`);
console.error(`${files.length} archivos incluidos.`);
