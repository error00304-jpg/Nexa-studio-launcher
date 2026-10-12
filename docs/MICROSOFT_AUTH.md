# Configurar el inicio de sesión Microsoft/Minecraft

El launcher usa el flujo **device code** de Microsoft Identity Platform (endpoint `consumers`), luego Xbox Live → XSTS → Minecraft Services (`login_with_xbox` y `/minecraft/profile`).
No se pide ni se guarda la contraseña. Solo se guarda el *refresh token*, cifrado con `safeStorage` (DPAPI en Windows).

## 1. Registrar la aplicación en Azure (gratis)
1. Entra a https://portal.azure.com con una cuenta Microsoft (puede pedir crear una cuenta Azure gratuita).
2. Busca **Microsoft Entra ID** → **Registros de aplicaciones** (App registrations) → **Nuevo registro**.
3. **Nombre**: p. ej. `NexaStudios Launcher`. No puede contener: Mojang, Minecraft, Microsoft, Live, Xbox, Discord, Hypixel.
4. **Tipos de cuenta compatibles**: *Solo cuentas Microsoft personales* (Personal Microsoft accounts only).
5. **URI de redirección**: déjalo vacío (el flujo device code no lo necesita). Pulsa **Registrar**.
6. En **Autenticación** → *Configuración avanzada* → **Permitir flujos de cliente público** = **Sí**. Guarda.
7. En **Información general** copia **Id. de aplicación (cliente)** y **Id. de directorio (inquilino)**.

## 2. Poner el Client ID en el launcher
Edita `launcher.config.json`:
```json
{ "microsoftClientId": "TU-CLIENT-ID" }
```
O define la variable de entorno `NEXA_MS_CLIENT_ID`. El Client ID no es un secreto. No se necesita *client secret*.

## 3. Aprobación de Mojang (obligatoria)
Minecraft Services rechaza Client IDs no aprobados con `403 "Invalid app registration"`.
Envía el formulario: https://aka.ms/mce-reviewappid (pide aceptar el EULA, correo de contacto, nombre de la app, Client ID y Tenant ID, y una breve justificación).
No hay plazo garantizado ni aprobación asegurada, sobre todo para proyectos individuales. Mientras no esté aprobado, el inicio de sesión llegará hasta Minecraft y mostrará un error claro.
No uses el Client ID de otro launcher.

## Limitaciones
- Cerrar sesión elimina los tokens locales; no revoca el acceso en los servidores de Microsoft (puedes quitarlo desde los ajustes de privacidad de tu cuenta Microsoft).
- El avatar es una inicial; mostrar la skin requeriría permitir imágenes remotas.
- Sin ejecutar contra los servicios reales: probado solo con respuestas simuladas (ver `test/auth.test.ts`).
