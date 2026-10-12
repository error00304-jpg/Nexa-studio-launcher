#!/usr/bin/env node
// Firma el documento de eventos. Uso:
//   node scripts/sign-events.mjs --in events.json --key nexa-signing-private.pem --out events.signed.json [--sequence N] [--valid-days N]
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1];
for (const k of ['in', 'key', 'out']) if (!args[k]) { console.error(`Falta --${k}`); process.exit(1); }

const payload = JSON.parse(readFileSync(args.in, 'utf8'));
payload.issuedAt = new Date().toISOString();
if (args.sequence) payload.sequence = Number(args.sequence);
if (args['valid-days']) payload.expiresAt = new Date(Date.now() + Number(args['valid-days']) * 86_400_000).toISOString();
if (!Number.isInteger(payload.sequence) || payload.sequence < 0) { console.error('"sequence" debe ser un entero >= 0 (súbelo en cada publicación).'); process.exit(1); }

const bytes = Buffer.from(JSON.stringify(payload));
const priv = createPrivateKey(readFileSync(args.key));
const signature = sign(null, bytes, priv);
if (!verify(null, bytes, createPublicKey(priv), signature)) { console.error('La autocomprobación de la firma falló.'); process.exit(1); }

writeFileSync(args.out, JSON.stringify({ alg: 'ed25519', payload: bytes.toString('base64'), signature: signature.toString('base64') }, null, 2));
console.error(`Firmado (sequence=${payload.sequence}). Sube ${args.out} a la URL configurada en "metadataUrl".`);
console.error(`Clave pública correspondiente: ${createPublicKey(priv).export({ type: 'spki', format: 'der' }).toString('base64')}`);
