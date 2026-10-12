// Elimina secretos de cualquier texto antes de guardarlo en el registro.
const PATTERNS: Array<[RegExp, string]> = [
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTADO]'],
  [/(--accessToken\s+)\S+/gi, '$1[REDACTADO]'],
  [
    /("?(?:access_token|refresh_token|id_token|token|password|client_secret)"?\s*[:=]\s*"?)[^"&\s,}]+/gi,
    '$1[REDACTADO]'
  ]
];

export function redact(text: string): string {
  return PATTERNS.reduce((acc, [re, rep]) => acc.replace(re, rep), text);
}
