// Cliente HTTP mínimo para el proceso principal: solo HTTPS, con timeout y límite de tamaño.
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 1_000_000;

export interface HttpResult {
  status: number;
  json: unknown;
}

async function request(url: string, init: RequestInit, maxBytes = MAX_BYTES): Promise<HttpResult> {
  if (!url.startsWith('https://')) throw new Error('Solo se permiten URLs HTTPS.');
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
  const text = await res.text();
  if (text.length > maxBytes) throw new Error('Respuesta demasiado grande.');
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

export const postJson = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body)
  });

export const postForm = (url: string, params: Record<string, string>) =>
  request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params).toString()
  });

export const getJson = (url: string, headers: Record<string, string> = {}, maxBytes = MAX_BYTES) =>
  request(url, { method: 'GET', headers: { Accept: 'application/json', ...headers } }, maxBytes);

/** Descarga binaria con límite estricto de tamaño (HTTPS, sin redirecciones, con timeout). */
export async function getBytes(url: string, maxBytes: number, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  if (!url.startsWith('https://')) throw new Error('Solo se permiten URLs HTTPS.');
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('Respuesta demasiado grande.');
  if (!res.body) throw new Error('Respuesta vacía.');
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('Respuesta demasiado grande.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
