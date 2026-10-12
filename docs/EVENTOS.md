# Eventos remotos con metadatos firmados — Fase 6

El launcher no trae eventos escritos en el código. Los descarga de **un archivo JSON firmado** alojado en tu servidor (HTTPS) y solo confía en él si la firma Ed25519 coincide con la clave pública incluida en el launcher.

## Cadena de confianza
1. `events.signed.json` (firmado con tu clave privada) → el launcher lo verifica con `signingPublicKey`.
2. Cada evento incluye `manifestSha256`: el hash del manifiesto del modpack. El launcher descarga el manifiesto y rechaza cualquier cambio.
3. El manifiesto lista cada archivo con su SHA-256. Los banners también llevan su SHA-256.
4. Protecciones: `sequence` creciente (impide volver a versiones antiguas), `expiresAt` opcional, límites de tamaño, solo HTTPS, solo hosts autorizados y esquema validado.

## Puesta en marcha
1. Genera las claves (una sola vez): `node scripts/keygen.mjs`. Guarda `nexa-signing-private.pem` en un lugar seguro (el .gitignore ya excluye `*.pem`). **Nunca** lo subas al repositorio.
2. Copia la clave pública en `launcher.config.json` → `"signingPublicKey"`.
3. Prepara el modpack y su manifiesto (ver `docs/MODPACK.md`); anota el SHA-256 que imprime `make-manifest.mjs`.
4. Copia `examples/events.example.json` a `events.json` y edítalo (ids, URLs, `manifestSha256`...). Sube `sequence` en cada publicación.
5. Firma: `node scripts/sign-events.mjs --in events.json --key nexa-signing-private.pem --out events.signed.json --valid-days 60`
6. Sube `events.signed.json`, los manifiestos y los banners a tu servidor HTTPS.
7. En `launcher.config.json`: `"metadataUrl": "https://TU-SERVIDOR/events.signed.json"` y `"modpackHosts": ["TU-SERVIDOR"]` (el host de `metadataUrl` ya se autoriza solo).
   El launcher no sigue redirecciones: usa la URL directa del archivo.

## Estados
`proximamente`, `disponible`, `mantenimiento`, `finalizado`. Además `access.opensAt` / `access.closesAt` abren y cierran el evento automáticamente. El bloqueo se aplica en el proceso principal: un evento en mantenimiento **no se instala ni se juega**, aunque se manipule la interfaz.

## Sin conexión
Se usa la última copia verificada (se vuelve a comprobar la firma). Si `expiresAt` ya pasó, se rechaza.

## Limitaciones
- Publicar a mano (firmar y subir) es provisional: en la Fase 7 el backend y el panel de administración lo harán.
- Si pierdes la clave privada hay que publicar un launcher nuevo con otra clave pública. No hay rotación de claves todavía.
- No hay estado del servidor en vivo (ping) todavía.
- Los textos de eventos y noticias se muestran como texto plano.
