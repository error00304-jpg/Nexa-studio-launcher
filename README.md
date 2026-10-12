# NexaStudios Launcher

Estado: **Fase 6** (eventos remotos con metadatos firmados Ed25519, mantenimiento, banners y noticias). Ver docs/EVENTOS.md.

## Desarrollo
```
npm install      # genera package-lock.json (commitéalo)
npm run dev
npm run typecheck && npm test
npm run build && npx electron .
```
Requiere Node 22+.

## Limitaciones conocidas (Fase 4)
- Solo versiones modernas (formato `arguments`, sin extracción de nativos). Las demás se rechazan con un mensaje claro.
- No descarga Java: busca JAVA_HOME, PATH y carpetas habituales (o la ruta de Ajustes).
- Las descargas fallidas se repiten desde cero; no se reanudan con `Range`.
- Probado con servidor simulado; la descarga y el lanzamiento reales deben probarse en Windows.
- Jugar requiere una sesión Microsoft con Minecraft Java (necesita Client ID aprobado por Mojang).
