# Arquitectura (Fase 1)

- `src/main`: proceso principal Electron (ventanas, IPC). Único con acceso al sistema.
- `src/preload`: puente `contextBridge` que expone `window.nexa` con métodos concretos.
- `src/shared`: contrato IPC (lista cerrada de canales) y validadores.
- `src/renderer`: UI React (Vite). Sin Node, sin fs; sandbox y CSP estricta.

Módulos futuros dentro de `src/main/`: `auth`, `minecraft`, `downloads`, `modpacks`, `events`, `updater`, `settings`, `logging`.
Backend y panel admin irán en `server/` y `admin/` (Fase 7).
