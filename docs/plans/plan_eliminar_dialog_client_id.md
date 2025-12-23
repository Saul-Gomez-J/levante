# Plan: Eliminar diálogo de Client ID y lanzar OAuth automático

Objetivo: evitar que el usuario vea un diálogo pidiendo `client_id`. Si no hay `client_id`, el flujo debe iniciarse automáticamente con DCR; solo fallará si el AS no soporta registro dinámico.

## Pasos

- Ajustar el store para disparar la autorización en cuanto llegue el evento `oauth/required`, sin mostrar modal.
  - Archivo: `src/renderer/stores/oauthStore.ts`
  - Cambios:
    - Añadir una función `autoAuthorizeFromRequired` que use los datos de `pendingAuth` para llamar a `authorize` con `clientId` indefinido y scopes por defecto (p.ej. `['mcp:read', 'mcp:write']` o derivados de `wwwAuth` si se quieren parsear).
    - En `handleOAuthRequired`, además de setear el error a null, invocar `autoAuthorizeFromRequired` y no mantener `pendingAuth` visible para UI (o limpiarlo tras disparar la llamada).
    - Añadir control de estado de carga/errores para mostrar feedback no modal (p.ej. toaster existente) reutilizando `errors` y `loading`.

- Quitar el diálogo de UI que pide `client_id`.
  - Archivo: `src/renderer/components/oauth/OAuthConnectionDialog.tsx`
  - Cambios:
    - Remover JSX del `Dialog` o convertirlo en no-op (retornar `null`) mientras el flujo es automático.
    - Si se mantiene el archivo, dejar un breve comentario indicando que el flujo ahora es headless y se usa para futuros casos manuales.
  - Archivo: `src/renderer/App.tsx`
    - Eliminar `<OAuthConnectionDialog />` del árbol principal o condicionar su renderizado a un flag desactivado.

- Opcional: derivar scopes del `WWW-Authenticate` para no pedir entrada al usuario.
  - Archivo: `src/main/services/oauth/OAuthDiscoveryService.ts` y/o `src/main/services/oauth/OAuthService.ts`
  - Cambios:
    - Exponer método para extraer `scope` desde `wwwAuthHeader` (si existe) y usarlo como `scopes` default en `authorize`.
    - Esto permite que el store no tenga que inferir scopes; pasa `undefined` y el backend ya toma scopes adecuados.

- Ajuste de scopes por defecto para respetar los parseados del header.
  - Archivo: `src/main/services/oauth/OAuthService.ts`
  - Cambios:
    - Al inicio de `authorize`, si `wwwAuthHeader` está presente, invocar `OAuthDiscoveryService.parseWWWAuthenticate` para obtener `scope` y, si viene, usarlo como `scopes` efectivo (spliteado por espacio). Si no hay scope en el header, mantener `['mcp:read', 'mcp:write']` o lo que se pase desde el caller.
    - Mantener el fallback actual, pero asegurarse de loggear qué scopes se usaron (parseados vs. default) para trazabilidad.

- Uso de client_id: solo el que llegue del caller; si no viene, se pasa vacío y se intenta DCR sin consultar almacenamiento.
  - Archivo: `src/main/services/oauth/OAuthService.ts`
  - Cambios:
    - Eliminar cualquier lookup de client_id/client_secret en preferencias para este flujo; confiar únicamente en `clientId` proporcionado en params. Si está vacío, ir directo a DCR.
    - Loggear explícitamente el branch seguido: “using provided client_id” vs “no client_id provided, attempting DCR”.

- Limpieza de estado para UX coherente.
  - Archivo: `src/renderer/stores/oauthStore.ts`
  - Cambios:
    - Asegurar que `loading` se marca por servidor mientras corre el flujo automático.
    - Si falla, registrar el error en `errors[serverId]` para mostrarlo en cualquier vista de estado de conexiones.

## Validación

- Probar manualmente: simular un 401 con `WWW-Authenticate` → el flujo debe abrir el navegador sin mostrar modal ni pedir `client_id`. Si el AS no soporta DCR, debe aparecer el error en la UI sin bloquear.
- Revisar que no quede JSX huérfano en `App.tsx`.
