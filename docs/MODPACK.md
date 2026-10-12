# Modpacks (Forge 1.20.1) — Fase 5

## 1. Qué necesitas
- Una carpeta con tu modpack (`mods/`, `config/`, ...).
- La **versión exacta de Forge** de tu modpack (p. ej. `47.x.y`).
- El **instalador de Forge** correspondiente (`forge-1.20.1-<versión>-installer.jar`), descargado de https://files.minecraftforge.net.
- Un servidor HTTPS donde alojar los archivos (GitHub Releases, Cloudflare R2, tu CDN...).

## 2. Generar el manifiesto
```
node scripts/make-manifest.mjs --dir ./mi-pack --base-url https://TU-SERVIDOR/mi-pack/ \
  --id nexa-evento1 --name "Evento 1" --version 1.0.0 \
  --minecraft 1.20.1 --loader forge --loader-version <VERSION_FORGE> \
  --installer ./forge-1.20.1-<VERSION_FORGE>-installer.jar --out manifest.json
```
Calcula SHA-256 y tamaño de cada archivo, y el SHA-256 del instalador. Sube los archivos a las URLs indicadas.

## 3. Autorizar tu servidor
En `launcher.config.json`: `"modpackHosts": ["TU-SERVIDOR"]` (solo el nombre de host). El launcher rechaza cualquier otro origen.
Si usas GitHub Releases, el enlace redirige a otros dominios: el launcher no verifica el destino de la redirección, pero **sí el SHA-256** del archivo.

## 4. Probar
`npm run dev` en Windows → Inicio → *Modpack (pruebas)* → **Cargar manifiesto…** → INSTALAR. Necesitas Java 17 para 1.20.1.

## Cómo funciona
- Instala Minecraft 1.20.1 vanilla y luego ejecuta el instalador de Forge (`--installClient`) con hash fijado por el manifiesto.
- Fusiona el perfil de Forge con el de vanilla (herencia) y verifica bibliotecas.
- Copia los archivos del manifiesto a `instances/<id>/`. Solo toca `mods`, `config`, `defaultconfigs`, `resourcepacks`, `shaderpacks`, `kubejs`, `scripts`.
- `mods/*` se mantiene idéntico al manifiesto; el resto (`config`...) solo se copia si falta, para no pisar cambios del jugador.
- Al actualizar borra únicamente los mods que el launcher instaló antes y que ya no están en el manifiesto. Nunca toca `saves/`, capturas ni otros archivos.

## Limitaciones
- Ejecutar el instalador de Forge implica ejecutar código descargado: por eso su hash va fijado en el manifiesto.
- El manifiesto de pruebas se carga a mano y **no está firmado** (la firma llega en la Fase 6).
- NeoForge está implementado con el mismo mecanismo pero sin probar; Fabric no.
- Sin probar contra Forge real: depende de que `--installClient` se comporte como documenta Forge.
