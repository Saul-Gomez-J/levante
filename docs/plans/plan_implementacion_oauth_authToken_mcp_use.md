# Plan: Alinear entrega de tokens OAuth a mcp-use (authToken/Bearer)

**Fecha:** 2025-12-23  
**Contexto:** El flujo OAuth ya entrega tokens válidos, pero mcp-use recibe 401 porque el token se pasa como header `Authorization: bearer ...` y no mediante el mecanismo recomendado (`authToken`/`Bearer`).  
**Objetivo:** Ajustar el cliente interno para que, cuando haya tokens OAuth, los entregue a mcp-use en el formato esperado (authToken o header con esquema `Bearer` capitalizado) y validar que la conexión HTTP/streamable-http se autentique correctamente.

---

## Alcance
- Transportes HTTP-based: `http`, `sse`, `streamable-http`.
- Cliente Node (desktop): no se usa el flujo OAuth interno de mcp-use; solo se le pasa el bearer ya obtenido.
- No se modifica el flujo OAuth existente; solo la forma de inyectar el token en la conexión.

## Suposiciones
- El token devuelto por Linear es válido; el problema es la forma de entrega a mcp-use.
- mcp-use respeta el campo `authToken` para todos los transportes HTTP-based.
- Seguirá siendo necesario mantener los headers custom, pero el bearer debe viajar por `authToken` o con esquema `Bearer`.

## Pasos de implementación
1) **Normalizar esquema del bearer a `Bearer`**
   - Archivo: `src/main/services/mcp/mcpUseService.ts`
   - Al recuperar tokens OAuth, construir `const bearer = \`Bearer ${tokens.accessToken}\`;` en vez de confiar en `tokenType` (que llega en minúsculas).
   - Usar este valor consistente en toda la configuración (authToken y headers).

2) **Usar el camino soportado por mcp-use: `authToken`**
   - Archivo: `src/main/services/mcp/mcpUseService.ts`
   - Al armar `serverConfig` para transportes HTTP-based, setear `serverConfig.authToken = bearer`.
   - Mantener headers existentes del usuario, pero no depender de `headers.Authorization` para el bearer (dejarlo solo como redundancia opcional).

3) **Mantener compatibilidad con headers**
   - Archivo: `src/main/services/mcp/mcpUseService.ts`
   - Si ya hay headers personalizados, asegurarse de que `Authorization` refleje el esquema `Bearer` (opcional como respaldo), sin sobrescribir otros headers.
   - Registrar en logs el `authToken` truncado y los headers para diagnóstico (sin filtrar en claro).

4) **Logging y diagnósticos**
   - Archivo: `src/main/services/mcp/mcpUseService.ts`
   - Añadir log explícito indicando que se está usando `authToken` y con qué longitud (truncado).
   - Ajustar el log de config sanitizada para mostrar `authToken` truncado.

5) **Pruebas manuales**
   - Ejecutar la app y conectar al servidor `linear` con transporte HTTP/streamable-http.
   - Verificar en logs que:
     - Se loguea “Using existing OAuth token” y “authToken configured”.
     - `Creating mcp-use client with config` muestra `authToken: <truncado>`.
   - Confirmar que no aparece el 401 “Authentication required”.

6) **(Opcional) Prueba negativa**
   - Forzar token inválido (simular expirado sin refresh) y confirmar que mcp-use devuelve 401, se captura y se dispara el flujo de refresh/OAuth como antes.

## Entregables
- Código actualizado en `src/main/services/mcp/mcpUseService.ts` con:
  - Normalización a `Bearer`
  - Uso de `authToken`
  - Logs de diagnóstico actualizados
- Validación manual documentada en `diagnostico-oauth-connection.md` (agregar sección de resultados tras probar).

## Riesgos / mitigaciones
- **Riesgo:** mcp-use ignore `authToken` en `streamable-http` si no está soportado.  
  **Mitigación:** mantener `Authorization` en headers como respaldo; revisar logs del request y, si falla, inspeccionar tráfico con un proxy local.
- **Riesgo:** tokenType distinto a “Bearer” en otros proveedores.  
  **Mitigación:** forzar esquema `Bearer` solo para servidores conocidos (Linear) o agregar una función de normalización parametrizada por servidor.
