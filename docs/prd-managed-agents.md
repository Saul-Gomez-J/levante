# PRD: Managed Agents (Agentes Gestionados)

## Resumen ejecutivo

Permitir que un admin de organización en Levante Platform cree **agentes preconfigurados** (combinaciones de MCPs, Skills, system prompt y modelo preferido) y los asigne a equipos o usuarios individuales. Los usuarios finales reciben estos agentes en su Levante Desktop sin necesidad de configuración técnica, listos para usar.

---

## Problema

Para aprovechar al máximo Levante, un usuario necesita:
1. Configurar múltiples MCPs (endpoints, API keys de terceros)
2. Instalar y configurar skills relevantes
3. Escribir system prompts efectivos
4. Seleccionar el modelo adecuado

Esto requiere conocimiento técnico significativo. En equipos donde hay perfiles no técnicos (ventas, marketing, soporte), la barrera de entrada es demasiado alta. Actualmente no existe forma de que un perfil técnico prepare el entorno para otro miembro del equipo.

---

## Solución

Crear un sistema de **Managed Agents** que funcione como un puente entre Levante Platform (web) y Levante Desktop:

1. El **admin** crea un agente en Platform: selecciona MCPs del catálogo, elige skills, escribe un system prompt, configura API keys y selecciona un modelo preferido
2. El admin **asigna** el agente a un team o usuario individual
3. El **usuario final** abre Levante Desktop, ve los agentes asignados y los activa con un click
4. Todo funciona sin configuración adicional: MCPs conectados, skills instaladas, prompt y modelo listos

---

## Usuarios objetivo

| Rol | Perfil | Acción principal |
|-----|--------|------------------|
| **Admin** | Perfil técnico, owner/admin de la organización | Crea, configura y asigna agentes |
| **Usuario final** | Miembro del equipo, cualquier nivel técnico | Recibe y usa agentes preconfigurados |

---

## Composición de un Agente

Un agente es un **paquete de configuración** que contiene:

| Componente | Descripción | Obligatorio |
|------------|-------------|-------------|
| **Nombre** | Nombre descriptivo del agente (ej: "Agente de Soporte") | Si |
| **Descripción** | Explicación del propósito del agente | Si |
| **Icono/Avatar** | Identificador visual | No |
| **System Prompt** | Instrucciones de comportamiento para el LLM | No |
| **MCPs** | Lista de MCPs del catálogo con sus configuraciones | No |
| **Skills** | Lista de skills del catálogo | No |
| **Modelo preferido** | Modelo por defecto (modificable por el usuario final) | No |
| **API Keys de MCPs/Skills** | Credenciales de servicios de terceros, encriptadas | No |

---

## Jerarquía y asignación

### Ubicación en la jerarquía

```
Organization
├── Agents (viven a nivel de org, visibles para admins)
│   ├── Agent "Soporte CRM"
│   ├── Agent "Dev Backend"
│   └── Agent "Marketing SEO"
├── Teams
│   ├── Team "Soporte" ← asignado: "Soporte CRM"
│   └── Team "Engineering" ← asignado: "Dev Backend"
└── Members
    └── User "Ana" ← asignado individualmente: "Marketing SEO"
```

### Reglas de asignación

- Un agente se crea a **nivel de organización**
- Se puede asignar a uno o más **teams**
- Se puede asignar a uno o más **usuarios individuales**
- Un team/usuario puede tener **múltiples agentes** asignados
- La asignación la hace el **owner o admin** de la organización

### API Keys y aislamiento

- **Asignación a team**: las API keys del agente se comparten entre todos los miembros del team
- **Asignación individual**: las API keys se aíslan para ese usuario específico
- Las API keys se almacenan **encriptadas en Supabase** (Platform) y se transmiten al desktop solo bajo demanda, via HTTPS, nunca en caché persistente en disco

---

## Modelo de datos (Supabase)

### Nuevas tablas

#### `agents`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | uuid | PK, auto-generated |
| `org_id` | uuid | FK → organizations(id), NOT NULL |
| `name` | text | Nombre del agente, NOT NULL |
| `description` | text | Descripción del agente |
| `icon` | text | URL o identificador de icono |
| `system_prompt` | text | System prompt del agente |
| `preferred_model` | text | ID del modelo preferido |
| `status` | text | 'draft' \| 'published' \| 'archived', DEFAULT 'draft' |
| `version` | integer | Version incremental para sincronización, DEFAULT 1 |
| `created_by` | uuid | FK → profiles(id) |
| `created_at` | timestamptz | DEFAULT now() |
| `updated_at` | timestamptz | DEFAULT now() |

**Indexes**: `(org_id)`, `(org_id, status)`
**RLS**: Solo miembros de la org pueden leer. Solo owner/admin pueden crear/modificar.

#### `agent_mcps`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | uuid | PK |
| `agent_id` | uuid | FK → agents(id) ON DELETE CASCADE |
| `mcp_id` | text | ID del MCP del catálogo (ej: "github/mcp-server") |
| `mcp_name` | text | Nombre para display |
| `configuration` | jsonb | Configuración del MCP (transport, template, inputs) |
| `sort_order` | integer | Orden de aparición, DEFAULT 0 |
| `created_at` | timestamptz | DEFAULT now() |

**Unique**: `(agent_id, mcp_id)`

#### `agent_skills`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | uuid | PK |
| `agent_id` | uuid | FK → agents(id) ON DELETE CASCADE |
| `skill_id` | text | ID de la skill del catálogo (ej: "development/react-patterns") |
| `skill_name` | text | Nombre para display |
| `sort_order` | integer | Orden de aparición, DEFAULT 0 |
| `created_at` | timestamptz | DEFAULT now() |

**Unique**: `(agent_id, skill_id)`

#### `agent_assignments`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | uuid | PK |
| `agent_id` | uuid | FK → agents(id) ON DELETE CASCADE |
| `team_id` | uuid | FK → teams(id) ON DELETE CASCADE, NULLABLE |
| `user_id` | uuid | FK → profiles(id) ON DELETE CASCADE, NULLABLE |
| `assigned_by` | uuid | FK → profiles(id) |
| `created_at` | timestamptz | DEFAULT now() |

**Constraints**:
- CHECK: `team_id IS NOT NULL OR user_id IS NOT NULL` (al menos uno)
- CHECK: `NOT (team_id IS NOT NULL AND user_id IS NOT NULL)` (solo uno, no ambos)
- UNIQUE: `(agent_id, team_id)` WHERE team_id IS NOT NULL
- UNIQUE: `(agent_id, user_id)` WHERE user_id IS NOT NULL

#### `agent_secrets`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | uuid | PK |
| `agent_id` | uuid | FK → agents(id) ON DELETE CASCADE |
| `assignment_id` | uuid | FK → agent_assignments(id) ON DELETE CASCADE, NULLABLE |
| `key_name` | text | Nombre de la clave (ej: "GITHUB_TOKEN") |
| `encrypted_value` | text | Valor encriptado con pgcrypto |
| `mcp_id` | text | MCP al que pertenece esta key, NULLABLE |
| `skill_id` | text | Skill al que pertenece esta key, NULLABLE |
| `created_at` | timestamptz | DEFAULT now() |
| `updated_at` | timestamptz | DEFAULT now() |

**Lógica de resolución de secrets**:
- Si `assignment_id` IS NULL → secret compartido del agente (para teams)
- Si `assignment_id` IS NOT NULL → secret aislado para esa asignación individual
- Al resolver, se prioriza: secret de asignación individual > secret compartido del agente

**RLS**: Solo owner/admin pueden leer/escribir. Los secrets nunca se exponen en queries directas del frontend web; solo se entregan via API autenticada al desktop.

---

## Autenticación

### Patrón actual de Platform

Platform utiliza un **único patrón de autenticación** basado en Bearer tokens para todas las APIs:

```
Authorization: Bearer <token>
```

El token se auto-detecta por formato:
- **API Key** (`lv_sk_*`): Acceso programático, scoped a team/org. Validado via `validateApiKey()` → RPC `validate_api_key`
- **OAuth JWT** (3 partes separadas por `.`): Sesión de usuario (web dashboard o desktop). Validado via `validateOAuthToken()` → RPC `validate_oauth_grant`

Ambos retornan un **contexto de autorización normalizado** con: `organizationId`, `teamId`, `userId`, `allowedModels`, límites TPM/budget, etc.

**Utilidades compartidas** (`apps/platform/lib/api/`):
- `validate-api-key.ts` → `validateApiKey(token): ApiKeyValidation`
- `validate-oauth-token.ts` → `validateOAuthToken(token, orgId?): OAuthTokenValidation`
- `authenticate-billing.ts` → `authenticateBillingRequest(req): BillingAuthContext` (solo JWT, sin API keys)

### Auth de los endpoints de Agents

Los endpoints de agentes usan el **patrón V1 dual** (API Key + OAuth JWT) desde el inicio:

| Tipo de endpoint | Auth aceptada | Justificación |
|------------------|---------------|---------------|
| **Gestión** (CRUD, asignaciones, secrets) | API Key (`lv_sk_*`) + OAuth JWT | Permite uso desde dashboard web (JWT) y desde terceros (API Key) en V2 |
| **Sync** (desktop descarga agentes) | OAuth JWT | Requiere identidad de usuario para resolver asignaciones y secrets |
| **Check** (polling de cambios) | OAuth JWT | Mismo que sync |

**Decisión de diseño para V2**: Al usar el patrón dual desde V1, la API de agentes queda lista para consumo por terceros sin cambios. Solo se necesitará añadir un scope `agents:manage` a la validación de API keys.

---

## API Endpoints (Platform)

Todos los endpoints requieren `Authorization: Bearer <token>`. Los endpoints de gestión aceptan API Key o JWT; los de sync solo JWT.

### Gestión de agentes (Admin)

```
POST   /api/v1/agents                    → Crear agente
GET    /api/v1/agents?org_id=X           → Listar agentes de la org
GET    /api/v1/agents/:id                → Obtener agente completo
PUT    /api/v1/agents/:id                → Actualizar agente
DELETE /api/v1/agents/:id                → Archivar agente (soft delete → status: 'archived')
POST   /api/v1/agents/:id/publish        → Publicar agente (draft → published)
```

### MCPs y Skills del agente (Admin)

```
POST   /api/v1/agents/:id/mcps           → Añadir MCP al agente
DELETE /api/v1/agents/:id/mcps/:mcpId    → Eliminar MCP del agente
POST   /api/v1/agents/:id/skills         → Añadir skill al agente
DELETE /api/v1/agents/:id/skills/:skillId → Eliminar skill del agente
```

### Asignaciones (Admin)

```
POST   /api/v1/agents/:id/assignments    → Asignar a team o usuario
DELETE /api/v1/agents/:id/assignments/:assignmentId → Desasignar
GET    /api/v1/agents/:id/assignments    → Ver asignaciones
```

### Secrets (Admin)

```
POST   /api/v1/agents/:id/secrets        → Añadir/actualizar secret
DELETE /api/v1/agents/:id/secrets/:secretId → Eliminar secret
GET    /api/v1/agents/:id/secrets        → Listar secrets (solo metadata, NO valores)
```

### Sincronización (Desktop ↔ Platform)

```
GET    /api/v1/agents/sync               → Obtener agentes asignados al usuario actual
```

**Request**: Bearer token (OAuth JWT)

**Response**:
```json
{
  "agents": [
    {
      "id": "uuid",
      "name": "Soporte CRM",
      "description": "Agente para equipo de soporte con acceso a CRM",
      "icon": "headset",
      "system_prompt": "Eres un asistente de soporte...",
      "preferred_model": "gpt-4o",
      "version": 3,
      "mcps": [
        {
          "mcp_id": "hubspot/mcp-server",
          "name": "HubSpot CRM",
          "configuration": {
            "transport": "stdio",
            "template": { "command": "npx", "args": ["-y", "@hubspot/mcp-server"] }
          },
          "resolved_inputs": {
            "HUBSPOT_API_KEY": "sk-hub-xxxxx"
          }
        }
      ],
      "skills": [
        {
          "skill_id": "productivity/google-workspace",
          "name": "Google Workspace"
        }
      ],
      "assignment_type": "team",
      "assignment_source": "Soporte"
    }
  ],
  "sync_version": "2026-03-19T10:30:00Z"
}
```

**Notas sobre el endpoint de sync**:
- Los `resolved_inputs` contienen las API keys ya desencriptadas para ese usuario
- Se entregan via HTTPS, autenticado con OAuth JWT
- El desktop NO persiste estas keys en disco; las mantiene solo en memoria durante la sesión
- El campo `version` permite al desktop detectar cambios sin descargar todo

### Polling eficiente

```
GET    /api/v1/agents/sync/check         → Check rápido de cambios
```

**Request**: Bearer token + header `If-Modified-Since` o query param `since=<timestamp>`

**Response** (si no hay cambios):
```
HTTP 304 Not Modified
```

**Response** (si hay cambios):
```json
{
  "has_changes": true,
  "changed_agent_ids": ["uuid1", "uuid3"],
  "sync_version": "2026-03-19T11:00:00Z"
}
```

Esto permite polling ligero (cada 5 minutos) sin descargar payloads grandes.

---

## Flujo del Admin (Platform Web)

### Crear un agente

```
1. Dashboard → Agents → "Nuevo Agente"
2. Formulario:
   ├── Nombre y descripción
   ├── System prompt (editor markdown)
   ├── Modelo preferido (dropdown de modelos disponibles en la org)
   ├── MCPs:
   │   ├── Buscar en catálogo de MCPs
   │   ├── Seleccionar MCPs → se añaden a la lista
   │   └── Para cada MCP: configurar inputs requeridos (API keys, endpoints)
   ├── Skills:
   │   ├── Buscar en catálogo de skills
   │   └── Seleccionar skills → se añaden a la lista
   └── Guardar como borrador
3. Revisar configuración → "Publicar"
4. Asignar:
   ├── Seleccionar teams (multi-select de teams de la org)
   └── Seleccionar usuarios individuales (multi-select de miembros)
5. Confirmar asignación
```

### Editar un agente

```
1. Dashboard → Agents → Click en agente
2. Modificar cualquier campo
3. Guardar → incrementa `version`
4. Los desktops detectan el cambio en el próximo polling o sync manual
```

---

## Flujo del Usuario Final (Levante Desktop)

### Descubrir agentes

```
1. Usuario abre Levante Desktop
2. Si está logueado en Platform:
   ├── Polling automático cada 5 minutos (configurable)
   ├── Botón "Sincronizar agentes" en la UI
   └── Notificación si hay agentes nuevos o actualizados
3. Sección "Mis Agentes" en el sidebar o settings:
   ├── Lista de agentes asignados
   ├── Cada agente muestra: nombre, descripción, MCPs incluidos, skills incluidas
   └── Badge de "nuevo" o "actualizado"
```

### Activar un agente

```
1. Usuario selecciona un agente
2. Desktop:
   ├── Descarga la configuración completa via /api/v1/agents/sync
   ├── Configura MCPs en memoria (NO persiste keys en disco)
   ├── Instala skills necesarias (si no están ya instaladas)
   ├── Aplica system prompt
   └── Selecciona modelo preferido
3. Usuario empieza a chatear con el agente activo
4. Los MCPs están conectados y funcionales
5. Las skills están disponibles en el contexto
```

### Cambiar de agente

```
1. Usuario puede cambiar de agente en cualquier momento
2. Al cambiar:
   ├── Se desconectan MCPs del agente anterior
   ├── Se aplica nueva configuración
   └── Se inicia nueva sesión de chat (o se mantiene la actual, TBD)
3. El modelo preferido se puede cambiar manualmente sin afectar el agente
```

---

## Sincronización

### Mecanismo

- **Polling**: Cada 5 minutos, el desktop hace `GET /api/v1/agents/sync/check`
- **Manual**: Botón "Sincronizar" en la UI que ejecuta el sync completo
- **Al iniciar**: Sync completo al abrir la app si hay conexión
- **Dirección**: Unidireccional (Platform → Desktop). El usuario NO modifica agentes localmente

### Detección de cambios

1. Desktop almacena `sync_version` (timestamp del último sync exitoso)
2. En cada check, envía `since=<sync_version>`
3. Si hay cambios, descarga solo los agentes modificados
4. Actualiza la configuración local en memoria

### Offline

- Si no hay conexión, los agentes previamente sincronizados **no funcionan** (requieren conexión para resolver secrets)
- Se muestra mensaje: "Conecta con Levante Platform para usar tus agentes"
- La UI puede mostrar los agentes como "desconectados" con su nombre y descripción visible

---

## Seguridad

### API Keys de terceros (secrets)

| Aspecto | Implementación |
|---------|---------------|
| **Almacenamiento** | Encriptados en Supabase con `pgcrypto` (AES-256) |
| **Transmisión** | Solo via HTTPS, en respuesta a request autenticado con OAuth JWT |
| **Persistencia en desktop** | Solo en memoria (RAM), nunca en disco |
| **Aislamiento** | Keys individuales aisladas por `assignment_id`; keys de team compartidas |
| **Revocación** | Al desasignar un agente, las keys dejan de ser accesibles inmediatamente |
| **Audit trail** | Cada acceso a secrets se registra en `audit_logs` |

### Control de acceso

| Acción | Quién puede |
|--------|-------------|
| Crear agente | Owner, Admin de la org |
| Editar agente | Owner, Admin de la org |
| Asignar agente | Owner, Admin de la org |
| Configurar secrets | Owner, Admin de la org |
| Ver agentes asignados | Cualquier miembro asignado |
| Usar agente | Cualquier miembro asignado |
| Modificar agente localmente | Nadie (bloqueado) |

### RLS Policies

```sql
-- agents: miembros de la org pueden leer agentes publicados que les estén asignados
-- agent_secrets: NUNCA se exponen via RLS; solo accesibles via función server-side
-- agent_assignments: miembros pueden ver sus propias asignaciones
```

---

## Impacto en Levante Desktop

### Nuevos componentes

| Componente | Ubicación | Descripción |
|-----------|-----------|-------------|
| `AgentPanel` | Sidebar | Lista de agentes asignados |
| `AgentCard` | Sidebar | Card de un agente con nombre, descripción, estado |
| `AgentSyncButton` | Sidebar/Settings | Botón de sincronización manual |
| `AgentActiveIndicator` | Header/Prompt | Indicador del agente activo |

### Nuevo store (Zustand)

```typescript
interface AgentStore {
  // Estado
  agents: ManagedAgent[]
  activeAgentId: string | null
  syncVersion: string | null
  isSyncing: boolean
  lastSyncAt: string | null

  // Acciones
  syncAgents(): Promise<void>        // Sync completo
  checkForUpdates(): Promise<boolean> // Check ligero
  activateAgent(agentId: string): Promise<void>
  deactivateAgent(): void

  // Polling
  startPolling(): void
  stopPolling(): void
}
```

### Nuevos IPC handlers

```typescript
'levante/agents:sync'           // Sincronizar agentes desde Platform
'levante/agents:check'          // Check de cambios
'levante/agents:activate'       // Activar agente (configurar MCPs, skills, prompt)
'levante/agents:deactivate'     // Desactivar agente
'levante/agents:getActive'      // Obtener agente activo
```

### Integración con sistemas existentes

| Sistema | Integración |
|---------|-------------|
| **MCPs** | Los MCPs del agente se configuran via `MCPService` existente, usando las keys resueltas |
| **Skills** | Las skills se instalan via `SkillsService` existente si no están ya presentes |
| **System Prompt** | Se inyecta en el contexto del chat via `ChatService` |
| **Modelo** | Se establece como modelo seleccionado via `ModelStore`, pero el usuario puede cambiarlo |
| **Platform Auth** | Se reutiliza el flujo OAuth existente de `PlatformService` |

---

## Relación con proyectos

Los agentes son **independientes de los proyectos** pero pueden coexistir:

- Un usuario puede tener un agente activo Y estar dentro de un proyecto
- En ese caso, el system prompt del agente se **combina** con la configuración del proyecto
- Los MCPs del agente se **suman** a los MCPs del proyecto
- Las skills del agente se **suman** a las skills del proyecto (sin duplicados)
- El modelo del agente aplica si no hay override del proyecto

En el futuro, se podría asociar un agente como "agente por defecto" de un proyecto, pero eso queda fuera del MVP.

---

## Fases de implementación

### Fase 1: MVP — Backend + Modelo de datos

**Platform (Web)**:
- [ ] Crear tablas: `agents`, `agent_mcps`, `agent_skills`, `agent_assignments`, `agent_secrets`
- [ ] Crear RLS policies
- [ ] Implementar API CRUD de agentes
- [ ] Implementar endpoint de sync (`/api/v1/agents/sync`)
- [ ] Implementar endpoint de check (`/api/v1/agents/sync/check`)
- [ ] Encriptación/desencriptación de secrets con pgcrypto

### Fase 2: MVP — Admin UI

**Platform (Web)**:
- [ ] Página de listado de agentes
- [ ] Formulario de creación/edición de agente
- [ ] Selector de MCPs del catálogo
- [ ] Selector de skills del catálogo
- [ ] Editor de system prompt
- [ ] Configuración de inputs/keys por MCP
- [ ] Panel de asignación a teams/usuarios
- [ ] Estados: borrador → publicado → archivado

### Fase 3: MVP — Desktop Integration

**Levante Desktop**:
- [ ] `AgentStore` (Zustand)
- [ ] IPC handlers para sync, activar, desactivar
- [ ] Servicio de sincronización con polling
- [ ] `AgentPanel` en sidebar
- [ ] Activación de agente: configurar MCPs, instalar skills, aplicar prompt
- [ ] Indicador de agente activo
- [ ] Botón de sync manual

### Fase 4: Post-MVP

- [ ] Notificaciones push de actualizaciones (Supabase Realtime)
- [ ] Agente por defecto en proyectos
- [ ] Métricas de uso por agente (qué agentes se usan más)
- [ ] Templates de agentes (clonar agentes entre orgs)
- [ ] Marketplace de agentes públicos
- [ ] Soporte offline con cache encriptado de secrets
- [ ] Permisos granulares (el usuario puede modificar parcialmente el agente)

### Fase 5: V2 — Open Platform API

- [ ] Scope `agents:manage` en validación de API keys
- [ ] Especificación OpenAPI / Swagger de todos los endpoints de agentes
- [ ] Webhooks para notificar cambios en agentes
- [ ] Rate limiting específico para endpoints de agentes
- [ ] Documentación pública de la API
- [ ] SDK clients (TypeScript, Python)
- [ ] Portal de desarrolladores para terceros

---

## V2: Open Platform API

### Visión

Abrir la API de Managed Agents para que **terceros** (empresas, integradores, plataformas propias) puedan gestionar agentes programáticamente, sin depender del dashboard web de Levante Platform ni de Levante Desktop.

### Caso de uso

Una empresa de consultoría tiene su propio portal interno. Via la API de Levante:
1. Su sistema crea agentes con MCPs y skills específicos para cada cliente
2. Configura API keys de los servicios del cliente
3. Asigna los agentes a los consultores relevantes
4. Los consultores usan Levante Desktop (o cualquier cliente compatible) y reciben los agentes listos

### Qué hace falta (sobre V1)

| Componente | Estado en V1 | Qué falta para V2 |
|-----------|-------------|-------------------|
| **Endpoints REST** | Ya en `/api/v1/agents/*` | Nada — ya están |
| **Auth dual (API Key + JWT)** | Ya implementado en V1 | Añadir scope `agents:manage` a la validación de API keys |
| **Formato de respuesta** | DTOs limpios, sin campos Supabase-específicos | Nada — ya están limpios |
| **Rate limiting** | Existe para chat/completions | Extender a endpoints de agentes |
| **Webhooks** | No existe | Nuevo sistema de webhooks basado en los eventos internos de V1 |
| **Documentación** | Interna | Generar OpenAPI spec + docs públicas |
| **SDKs** | No existe | Generar desde OpenAPI spec |

### Preparación en V1 (ya incorporada)

Las siguientes decisiones de V1 garantizan que V2 sea un incremento, no un refactor:

1. **Endpoints bajo `/api/v1/`**: Todos los endpoints de agentes viven en el namespace versionado, no en rutas ad-hoc
2. **Auth dual desde el inicio**: Los endpoints de gestión aceptan API Key y JWT, usando las mismas utilidades que `/api/v1/chat/completions`
3. **Evento interno de cambio**: Cuando un agente se actualiza, se incrementa `version` y se registra en `audit_logs`. En V2, este mismo evento dispara webhooks — solo hay que añadir el dispatcher

### Webhooks (V2)

```
POST /api/v1/webhooks                    → Registrar webhook
GET  /api/v1/webhooks                    → Listar webhooks
DELETE /api/v1/webhooks/:id              → Eliminar webhook
```

**Eventos soportados**:
- `agent.created` — Se crea un agente
- `agent.updated` — Se modifica un agente (incluye version)
- `agent.published` — Se publica un agente
- `agent.archived` — Se archiva un agente
- `agent.assigned` — Se asigna un agente a team/usuario
- `agent.unassigned` — Se desasigna un agente

**Payload del webhook**:
```json
{
  "event": "agent.updated",
  "timestamp": "2026-03-19T11:00:00Z",
  "data": {
    "agent_id": "uuid",
    "org_id": "uuid",
    "version": 4,
    "changed_fields": ["system_prompt", "mcps"]
  }
}
```

### Scope de API Keys (V2)

Ampliar el RPC `validate_api_key` para soportar scopes:

| Scope | Permite |
|-------|---------|
| `agents:read` | Listar y leer agentes de la org |
| `agents:manage` | CRUD completo de agentes, asignaciones y secrets |
| `agents:sync` | Endpoint de sync (alternativa a OAuth JWT para integraciones server-to-server) |

Los scopes se almacenan en la columna `models_allowed` existente de `api_keys` (renombrada a `scopes` o añadiendo columna `permissions jsonb`).

---

## Métricas de éxito

| Métrica | Objetivo |
|---------|----------|
| Tiempo de onboarding de un usuario nuevo | < 2 minutos (vs. 30+ min configuración manual) |
| % de usuarios no-técnicos que usan agentes | > 80% de miembros asignados |
| Agentes creados por organización | > 2 en el primer mes |
| Tasa de sincronización exitosa | > 99% |
| Tiempo medio de activación de agente | < 5 segundos |

---

## Preguntas abiertas

1. **Límites por plan**: ¿Cuántos agentes puede crear una org free vs. advanced vs. pro?
2. **Versionado de agentes**: ¿Se guarda historial de versiones para rollback?
3. **Notificaciones**: ¿Cómo se notifica al usuario de un agente nuevo/actualizado? ¿Toast, badge, email?
4. **Conflictos MCP**: Si el usuario ya tiene un MCP configurado manualmente y el agente trae el mismo MCP, ¿se prioriza la config del agente?
5. **Modelo por defecto**: Si el modelo preferido del agente no está disponible para el usuario (ej: no tiene API key del proveedor), ¿qué pasa?
6. **Concurrent agents**: ¿Se puede tener más de un agente activo simultáneamente, o solo uno a la vez?

---

## Referencias técnicas

### Platform (levante-platform-c1)
- **Auth — API Key validation**: `apps/platform/lib/api/validate-api-key.ts` → `validateApiKey()`, `extractApiKey()`
- **Auth — OAuth validation**: `apps/platform/lib/api/validate-oauth-token.ts` → `validateOAuthToken()`, `isOAuthToken()`
- **Auth — Billing (JWT-only)**: `apps/platform/lib/api/authenticate-billing.ts` → `authenticateBillingRequest()`
- **Auth — Ejemplo de uso dual**: `apps/platform/app/api/v1/chat/completions/route.ts`
- **MCP Descriptor**: `apps/services/src/modules/mcps/types.ts` → `MCPServerDescriptor`
- **Skill Descriptor**: `apps/services/src/modules/skills/` → `SkillDescriptor`
- **Org/Team schema**: `apps/platform/supabase/migrations/`

### Desktop (levante-dev)
- **Platform Service**: `src/main/services/platformService.ts`
- **MCP Service**: `src/main/services/mcp/`
- **Skills Service**: `src/main/services/skillsService.ts`
- **Skills Store**: `src/renderer/stores/skillsStore.ts`
