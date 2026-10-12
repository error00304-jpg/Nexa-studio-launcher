#!/usr/bin/env node
// Genera el par de claves Ed25519 con el que se firman los eventos.
// Uso: node scripts/keygen.mjs [--out nexa-signing]
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const out = process.argv[2] === '--out' && process.argv[3] ? process.argv[3] : 'nexa-signing';
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
writeFileSync(`${out}-private.pem`, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
writeFileSync(`${out}-public.txt`, `${pub}\n`);
console.log(`Clave privada: ${out}-private.pem  (SECRETA: no la subas al repositorio ni la compartas)`);
console.log(`Clave pública (pégala en launcher.config.json -> "signingPublicKey"):\n${pub}`);
