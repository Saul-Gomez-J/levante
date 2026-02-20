# RUNBOOK DE IMPLEMENTACION: Skills Store para Levante

> Documento operativo y autocontenido para implementar la Skills Store de extremo a extremo en Levante.
> Este runbook esta escrito para que una IA lo ejecute sin contexto adicional.

---

## 0. Objetivo y resultado final

Al finalizar esta implementacion, la app debe soportar:

1. Catalogo remoto de skills desde `https://services.levanteapp.com/api/skills.json`.
2. Cache local de catalogo en disco con TTL de 1 hora y fallback offline.
3. Instalacion/desinstalacion de skills en `~/levante/skills/{category}/{name}.md`.
4. Listado local de skills instaladas.
5. Nueva pagina UI `Skills` con busqueda, filtro por categoria, install/uninstall y modal de detalles.
6. Deep link de instalacion:
   `levante://skill/install?id=category%2Fname`
7. Modal de confirmacion antes de instalar una skill desde deep link.

---

## 1. Restricciones arquitectonicas obligatorias (IMPORTANT)

Estas reglas son obligatorias para no romper el repo actual:

1. **Registro IPC**: los handlers NO se registran en `src/main/main.ts`.
   Deben registrarse en `src/main/lifecycle/initialization.ts` dentro de `registerIPCHandlers()`.

2. **Logger en main**: usar `getLogger()` desde `src/main/services/logging`.
   No usar `import { logger } from './logging/logger'`.

3. **DeepLinkAction duplicado**:
   Debe actualizarse en ambos archivos:
   - `src/main/services/deepLinkService.ts`
   - `src/preload/types/index.ts`

4. **Preload tipado estricto**:
   Al agregar `window.levante.skills`, hay que actualizar:
   - `src/preload/preload.ts` interfaz `LevanteAPI`
   - `src/preload/preload.ts` objeto `api`

5. **Rutas TS en renderer**:
   No existe alias para `src/types/*`.
   Usar rutas relativas correctas (`../../types/...`, `../../../types/...`) segun profundidad.

6. **Seguridad de filesystem**:
   Nunca usar `skill.name` directamente como nombre de archivo.
   Usar segmentos del `skill.id` sanitizados (`category/name`).

---

## 2. Alcance exacto

Incluye:

1. Tipos compartidos de skills.
2. Servicio main de catalogo/cache/instalacion.
3. Handlers IPC + preload API.
4. Store Zustand para skills.
5. Componentes UI y pagina Skills.
6. Navegacion en sidebar.
7. Deep link parser + manejo en renderer.
8. i18n minimo para etiqueta de navegacion.
9. Validaciones manuales y checklist de finalizacion.

No incluye:

1. Marketplace con autenticacion.
2. Rating, reviews o analitica de skills.
3. Auto-update de skills instaladas.

---

## 3. Contrato de datos

### 3.1 Endpoint remoto

Se asume respuesta JSON en:

- `GET https://services.levanteapp.com/api/skills.json`

Estructura esperada:

```json
{
  "version": "2026-02-20",
  "total": 120,
  "skills": [
    {
      "id": "development/react-patterns",
      "name": "React Patterns",
      "description": "...",
      "category": "development",
      "content": "# ...",
      "tags": ["react", "frontend"]
    }
  ]
}
```

### 3.2 IDs de skill

Regla obligatoria:

- `skill.id` siempre debe cumplir `category/name` (exactamente un `/`).

Se usara `id` como fuente de verdad para rutas de instalacion.

---

## 4. Archivos a crear/modificar

### 4.1 Nuevos archivos

1. `src/types/skills.ts`
2. `src/main/services/skillsService.ts`
3. `src/main/ipc/skillsHandlers.ts`
4. `src/preload/api/skills.ts`
5. `src/renderer/stores/skillsStore.ts`
6. `src/renderer/components/skills/SkillCard.tsx`
7. `src/renderer/components/skills/SkillCategoryFilter.tsx`
8. `src/renderer/components/skills/SkillDetailsModal.tsx`
9. `src/renderer/components/skills/SkillInstallDeepLinkModal.tsx`
10. `src/renderer/pages/SkillsPage.tsx`

### 4.2 Archivos existentes a modificar

1. `src/main/lifecycle/initialization.ts`
2. `src/preload/preload.ts`
3. `src/preload/types/index.ts`
4. `src/main/services/deepLinkService.ts`
5. `src/renderer/App.tsx`
6. `src/renderer/components/layout/MainLayout.tsx`
7. `src/renderer/locales/en/common.json`
8. `src/renderer/locales/es/common.json`

---

## 5. Implementacion paso a paso

## Paso 1. Tipos compartidos

Crear `src/types/skills.ts`:

```ts
export interface SkillDescriptor {
  /** Formato obligatorio: "category/name" */
  id: string;
  name: string;
  description: string;
  category: string;
  author?: string;
  version?: string;
  license?: string;
  tags?: string[];
  allowedTools?: string;
  model?: string;
  userInvocable?: boolean;
  dependencies?: string[];
  source?: string;
  repo?: string;
  metadata?: Record<string, unknown>;
  /** Markdown sin frontmatter */
  content: string;
}

export interface SkillCategory {
  category: string;
  displayName: string;
  count: number;
}

export interface SkillsCatalogResponse {
  version: string;
  total: number;
  skills: SkillDescriptor[];
}

export interface InstalledSkill extends SkillDescriptor {
  installedAt: string; // ISO 8601
  filePath: string; // ~/levante/skills/{category}/{name}.md
}

export type IPCResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };
```

Criterio de aceptacion:

1. Compila sin referencias circulares.
2. Importable desde main/preload/renderer.

---

## Paso 2. Servicio main de skills

Crear `src/main/services/skillsService.ts`.

### 2.1 Implementacion completa (copiar base)

```ts
import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getLogger } from './logging';
import { directoryService } from './directoryService';
import type {
  SkillDescriptor,
  SkillsCatalogResponse,
  SkillCategory,
  InstalledSkill,
} from '../../types/skills';

const logger = getLogger();

const SERVICES_HOST = 'https://services.levanteapp.com';
const CATALOG_ENDPOINT = '/api/skills.json';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

interface CacheEntry {
  timestamp: number;
  data: SkillsCatalogResponse;
}

function getCachePath(): string {
  return path.join(app.getPath('userData'), 'skills-cache.json');
}

function getSkillsDir(): string {
  return directoryService.getSubdirPath('skills');
}

function splitSkillId(skillId: string): { category: string; name: string } {
  const normalized = decodeURIComponent(skillId).trim();
  const match = normalized.match(/^([^/]+)\/([^/]+)$/);
  if (!match) {
    throw new Error(`Invalid skill id format: "${skillId}". Expected "category/name".`);
  }

  return {
    category: match[1],
    name: match[2],
  };
}

function sanitizePathSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);
}

function buildInstalledPath(skillId: string): { category: string; name: string; filePath: string } {
  const parts = splitSkillId(skillId);
  const category = sanitizePathSegment(parts.category);
  const name = sanitizePathSegment(parts.name);

  if (!category || !name) {
    throw new Error(`Invalid skill id after sanitization: ${skillId}`);
  }

  const filePath = path.join(getSkillsDir(), category, `${name}.md`);
  return { category, name, filePath };
}

function yamlString(value: string): string {
  return JSON.stringify(value ?? '');
}

function buildSkillFile(skill: SkillDescriptor, installedAt: string): string {
  const lines: string[] = ['---'];

  lines.push(`id: ${yamlString(skill.id)}`);
  lines.push(`name: ${yamlString(skill.name)}`);
  lines.push(`description: ${yamlString(skill.description)}`);
  lines.push(`category: ${yamlString(skill.category)}`);

  if (skill.author) lines.push(`author: ${yamlString(skill.author)}`);
  if (skill.version) lines.push(`version: ${yamlString(skill.version)}`);
  if (skill.license) lines.push(`license: ${yamlString(skill.license)}`);
  if (skill.tags?.length) lines.push(`tags: [${skill.tags.map((tag) => yamlString(tag)).join(', ')}]`);
  if (skill.allowedTools) lines.push(`allowed-tools: ${yamlString(skill.allowedTools)}`);
  if (skill.model) lines.push(`model: ${yamlString(skill.model)}`);
  if (typeof skill.userInvocable === 'boolean') lines.push(`user-invocable: ${skill.userInvocable}`);
  if (skill.dependencies?.length) lines.push(`dependencies: [${skill.dependencies.map((d) => yamlString(d)).join(', ')}]`);
  if (skill.source) lines.push(`source: ${yamlString(skill.source)}`);
  if (skill.repo) lines.push(`repo: ${yamlString(skill.repo)}`);

  lines.push(`installed-at: ${yamlString(installedAt)}`);
  lines.push('---');
  lines.push('');
  lines.push(skill.content ?? '');

  return lines.join('\n');
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; content: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error('Invalid skill file: missing YAML frontmatter');
  }

  const [, frontmatter, content] = match;
  const meta: Record<string, string> = {};

  for (const line of frontmatter.split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();

    value = value.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    meta[key] = value;
  }

  return { meta, content: content.trim() };
}

async function apiFetch<T>(endpoint: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(`${SERVICES_HOST}${endpoint}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Skills API error ${res.status} on ${endpoint}`);
    }

    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export class SkillsService {
  async getCatalog(): Promise<SkillsCatalogResponse> {
    const cachePath = getCachePath();

    // 1) cache valida
    try {
      const raw = await fs.readFile(cachePath, 'utf-8');
      const cached = JSON.parse(raw) as CacheEntry;
      const isExpired = Date.now() - cached.timestamp > CACHE_TTL_MS;

      if (!isExpired) {
        logger.core.debug('Skills catalog served from cache');
        return cached.data;
      }
    } catch {
      // ignore cache miss/corruption
    }

    // 2) fetch remoto
    try {
      const data = await apiFetch<SkillsCatalogResponse>(CATALOG_ENDPOINT);

      // persist cache (best effort)
      const cacheEntry: CacheEntry = {
        timestamp: Date.now(),
        data,
      };

      const tmpPath = `${cachePath}.tmp`;
      await fs.writeFile(tmpPath, JSON.stringify(cacheEntry), 'utf-8');
      await fs.rename(tmpPath, cachePath);

      return data;
    } catch (error) {
      // 3) fallback cache stale
      logger.core.warn('Skills API unreachable, trying stale cache fallback', {
        error: error instanceof Error ? error.message : String(error),
      });

      try {
        const raw = await fs.readFile(cachePath, 'utf-8');
        const cached = JSON.parse(raw) as CacheEntry;
        return cached.data;
      } catch {
        throw error;
      }
    }
  }

  async getCategories(): Promise<{ categories: SkillCategory[] }> {
    const catalog = await this.getCatalog();

    const counts = new Map<string, number>();
    for (const skill of catalog.skills) {
      const key = skill.category?.trim() || 'uncategorized';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const categories: SkillCategory[] = [...counts.entries()]
      .map(([category, count]) => ({
        category,
        displayName: category,
        count,
      }))
      .sort((a, b) => a.category.localeCompare(b.category));

    return { categories };
  }

  async installSkill(skill: SkillDescriptor): Promise<InstalledSkill> {
    if (!skill?.id) {
      throw new Error('Cannot install skill: missing id');
    }

    await directoryService.ensureBaseDir();

    const { category, filePath } = buildInstalledPath(skill.id);
    const categoryDir = path.dirname(filePath);

    await fs.mkdir(categoryDir, { recursive: true });

    const installedAt = new Date().toISOString();
    const fileContent = buildSkillFile(skill, installedAt);
    await fs.writeFile(filePath, fileContent, 'utf-8');

    logger.core.info('Skill installed', { skillId: skill.id, filePath });

    return {
      ...skill,
      installedAt,
      filePath,
      category,
    };
  }

  async uninstallSkill(skillId: string): Promise<void> {
    const { category, filePath } = buildInstalledPath(skillId);

    try {
      await fs.unlink(filePath);
      logger.core.info('Skill uninstalled', { skillId, filePath });
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
      logger.core.warn('Skill file not found during uninstall, continuing', { skillId, filePath });
    }

    // limpiar carpeta de categoria si queda vacia
    const categoryDir = path.join(getSkillsDir(), category);
    try {
      const remaining = await fs.readdir(categoryDir);
      if (remaining.length === 0) {
        await fs.rmdir(categoryDir);
      }
    } catch {
      // ignore cleanup errors
    }
  }

  async isInstalled(skillId: string): Promise<boolean> {
    const { filePath } = buildInstalledPath(skillId);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async listInstalledSkills(): Promise<InstalledSkill[]> {
    const baseDir = getSkillsDir();
    const installed: InstalledSkill[] = [];

    try {
      const categories = await fs.readdir(baseDir, { withFileTypes: true });

      for (const categoryEntry of categories) {
        if (!categoryEntry.isDirectory()) continue;

        const category = categoryEntry.name;
        const categoryDir = path.join(baseDir, category);
        const files = await fs.readdir(categoryDir, { withFileTypes: true });

        for (const fileEntry of files) {
          if (!fileEntry.isFile()) continue;
          if (!fileEntry.name.endsWith('.md')) continue;

          const filePath = path.join(categoryDir, fileEntry.name);
          const fallbackName = fileEntry.name.replace(/\.md$/, '');

          try {
            const raw = await fs.readFile(filePath, 'utf-8');
            const { meta, content } = parseFrontmatter(raw);

            const metaId = meta['id']?.trim();
            const skillId = metaId && /^([^/]+)\/([^/]+)$/.test(metaId)
              ? metaId
              : `${category}/${fallbackName}`;

            installed.push({
              id: skillId,
              name: meta['name'] ?? fallbackName,
              description: meta['description'] ?? '',
              category: meta['category'] ?? category,
              author: meta['author'],
              version: meta['version'],
              license: meta['license'],
              allowedTools: meta['allowed-tools'],
              model: meta['model'],
              userInvocable: meta['user-invocable'] === 'true',
              content,
              installedAt: meta['installed-at'] ?? new Date().toISOString(),
              filePath,
            });
          } catch (error) {
            logger.core.warn('Failed to parse installed skill file', {
              filePath,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    } catch {
      // carpeta aun no existe => lista vacia
    }

    installed.sort((a, b) => a.id.localeCompare(b.id));
    return installed;
  }
}

export const skillsService = new SkillsService();
```

### 2.2 Decisiones clave en este servicio

1. `getCategories()` se deriva del catalogo local/remoto para funcionar offline.
2. Instalacion usa `skill.id` (no `skill.name`) para evitar inconsistencias.
3. Segmentos de ruta se sanitizan para evitar path traversal.
4. Cache se escribe de forma atomica (`.tmp` + `rename`).

---

## Paso 3. IPC handlers

Crear `src/main/ipc/skillsHandlers.ts`.

```ts
import { ipcMain } from 'electron';
import { getLogger } from '../services/logging';
import { skillsService } from '../services/skillsService';
import type { SkillDescriptor } from '../../types/skills';

const logger = getLogger();

function ok<T>(data: T) {
  return { success: true as const, data };
}

function fail(error: unknown) {
  return {
    success: false as const,
    error: error instanceof Error ? error.message : String(error),
  };
}

export function setupSkillsHandlers(): void {
  ipcMain.removeHandler('levante/skills:getCatalog');
  ipcMain.handle('levante/skills:getCatalog', async () => {
    try {
      const data = await skillsService.getCatalog();
      return ok(data);
    } catch (error) {
      logger.ipc.error('Failed to fetch skills catalog', {
        error: error instanceof Error ? error.message : String(error),
      });
      return fail(error);
    }
  });

  ipcMain.removeHandler('levante/skills:getCategories');
  ipcMain.handle('levante/skills:getCategories', async () => {
    try {
      const data = await skillsService.getCategories();
      return ok(data);
    } catch (error) {
      logger.ipc.error('Failed to fetch skills categories', {
        error: error instanceof Error ? error.message : String(error),
      });
      return fail(error);
    }
  });

  ipcMain.removeHandler('levante/skills:install');
  ipcMain.handle('levante/skills:install', async (_, skill: SkillDescriptor) => {
    try {
      const installed = await skillsService.installSkill(skill);
      return ok(installed);
    } catch (error) {
      logger.ipc.error('Failed to install skill', {
        skillId: skill?.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return fail(error);
    }
  });

  ipcMain.removeHandler('levante/skills:uninstall');
  ipcMain.handle('levante/skills:uninstall', async (_, skillId: string) => {
    try {
      await skillsService.uninstallSkill(skillId);
      return ok(true);
    } catch (error) {
      logger.ipc.error('Failed to uninstall skill', {
        skillId,
        error: error instanceof Error ? error.message : String(error),
      });
      return fail(error);
    }
  });

  ipcMain.removeHandler('levante/skills:listInstalled');
  ipcMain.handle('levante/skills:listInstalled', async () => {
    try {
      const data = await skillsService.listInstalledSkills();
      return ok(data);
    } catch (error) {
      logger.ipc.error('Failed to list installed skills', {
        error: error instanceof Error ? error.message : String(error),
      });
      return fail(error);
    }
  });

  ipcMain.removeHandler('levante/skills:isInstalled');
  ipcMain.handle('levante/skills:isInstalled', async (_, skillId: string) => {
    try {
      const data = await skillsService.isInstalled(skillId);
      return ok(data);
    } catch (error) {
      logger.ipc.error('Failed to check if skill is installed', {
        skillId,
        error: error instanceof Error ? error.message : String(error),
      });
      return fail(error);
    }
  });

  logger.ipc.info('Skills IPC handlers registered');
}
```

---

## Paso 4. Registrar handlers en lifecycle (NO en main.ts)

Modificar `src/main/lifecycle/initialization.ts`.

### 4.1 Import

Agregar:

```ts
import { setupSkillsHandlers } from '../ipc/skillsHandlers';
```

### 4.2 Registro

Dentro de `registerIPCHandlers()` agregar:

```ts
setupSkillsHandlers();
```

Ubicarlo junto al resto de handlers app-level.

---

## Paso 5. Preload API de skills

Crear `src/preload/api/skills.ts`.

```ts
import { ipcRenderer } from 'electron';
import type {
  SkillDescriptor,
  SkillsCatalogResponse,
  SkillCategory,
  InstalledSkill,
  IPCResult,
} from '../../types/skills';

export const skillsApi = {
  getCatalog: (): Promise<IPCResult<SkillsCatalogResponse>> =>
    ipcRenderer.invoke('levante/skills:getCatalog'),

  getCategories: (): Promise<IPCResult<{ categories: SkillCategory[] }>> =>
    ipcRenderer.invoke('levante/skills:getCategories'),

  install: (skill: SkillDescriptor): Promise<IPCResult<InstalledSkill>> =>
    ipcRenderer.invoke('levante/skills:install', skill),

  uninstall: (skillId: string): Promise<IPCResult<boolean>> =>
    ipcRenderer.invoke('levante/skills:uninstall', skillId),

  listInstalled: (): Promise<IPCResult<InstalledSkill[]>> =>
    ipcRenderer.invoke('levante/skills:listInstalled'),

  isInstalled: (skillId: string): Promise<IPCResult<boolean>> =>
    ipcRenderer.invoke('levante/skills:isInstalled', skillId),
};
```

---

## Paso 6. Exponer API en preload tipado

Modificar `src/preload/preload.ts`.

### 6.1 Importar API

Agregar en imports de modulos API:

```ts
import { skillsApi } from './api/skills';
```

### 6.2 Tipar la interfaz `LevanteAPI`

Agregar bloque:

```ts
skills: {
  getCatalog: () => Promise<import('../types/skills').IPCResult<import('../types/skills').SkillsCatalogResponse>>;
  getCategories: () => Promise<import('../types/skills').IPCResult<{ categories: import('../types/skills').SkillCategory[] }>>;
  install: (skill: import('../types/skills').SkillDescriptor) => Promise<import('../types/skills').IPCResult<import('../types/skills').InstalledSkill>>;
  uninstall: (skillId: string) => Promise<import('../types/skills').IPCResult<boolean>>;
  listInstalled: () => Promise<import('../types/skills').IPCResult<import('../types/skills').InstalledSkill[]>>;
  isInstalled: (skillId: string) => Promise<import('../types/skills').IPCResult<boolean>>;
};
```

Nota:

- Si prefieres limpiar imports inline, importa tipos arriba y evita `import('...')` inline.

### 6.3 Agregar al objeto `api`

Dentro de `const api: LevanteAPI = { ... }`, agregar:

```ts
skills: skillsApi,
```

---

## Paso 7. Extender tipos de deep link (preload y main)

Modificar `src/preload/types/index.ts`.

Cambiar:

```ts
export interface DeepLinkAction {
  type: 'mcp-add' | 'mcp-configure' | 'chat-new';
  data: Record<string, unknown>;
}
```

por:

```ts
export interface DeepLinkAction {
  type: 'mcp-add' | 'mcp-configure' | 'chat-new' | 'skill-install';
  data: Record<string, unknown>;
}
```

Luego modificar `src/main/services/deepLinkService.ts` exactamente igual en la interfaz `DeepLinkAction` local.

---

## Paso 8. Agregar parser deep link de skills en main

Modificar `src/main/services/deepLinkService.ts`.

### 8.1 Enrutado en `parseDeepLink()`

Agregar rama:

```ts
} else if (category === 'skill' && action === 'install') {
  return this.parseSkillInstallLink(params);
}
```

### 8.2 Nuevo metodo privado

Agregar metodo:

```ts
private parseSkillInstallLink(params: Record<string, string>): DeepLinkAction | null {
  const idRaw = (params['id'] ?? '').trim();
  const id = decodeURIComponent(idRaw);

  if (!id) {
    logger.core.warn('Invalid skill deep link: missing id', { params });
    return null;
  }

  const match = id.match(/^([^/]+)\/([^/]+)$/);
  if (!match) {
    logger.core.warn('Invalid skill deep link: id must be category/name', { id });
    return null;
  }

  const category = match[1];
  const name = match[2];

  return {
    type: 'skill-install',
    data: {
      skillId: `${category}/${name}`,
      category,
      name,
    },
  };
}
```

Criterio de aceptacion:

1. `levante://skill/install?id=dev%2Freact` produce `type: skill-install`.
2. IDs invalidos se rechazan con `null`.

---

## Paso 9. Store Zustand de skills

Crear `src/renderer/stores/skillsStore.ts`.

```ts
import { create } from 'zustand';
import type {
  SkillDescriptor,
  SkillCategory,
  InstalledSkill,
} from '../../types/skills';

interface SkillsStore {
  catalog: SkillDescriptor[];
  categories: SkillCategory[];
  installedSkills: InstalledSkill[];
  installedIds: Set<string>;
  isLoadingCatalog: boolean;
  isLoadingInstalled: boolean;
  error: string | null;

  loadCatalog: () => Promise<void>;
  loadCategories: () => Promise<void>;
  loadInstalled: () => Promise<void>;
  installSkill: (skill: SkillDescriptor) => Promise<void>;
  uninstallSkill: (skillId: string) => Promise<void>;
  isInstalled: (skillId: string) => boolean;
  clearError: () => void;
}

export const useSkillsStore = create<SkillsStore>((set, get) => ({
  catalog: [],
  categories: [],
  installedSkills: [],
  installedIds: new Set(),
  isLoadingCatalog: false,
  isLoadingInstalled: false,
  error: null,

  clearError: () => set({ error: null }),

  loadCatalog: async () => {
    set({ isLoadingCatalog: true, error: null });

    try {
      const result = await window.levante.skills.getCatalog();
      if (!result.success) {
        throw new Error(result.error);
      }

      set({
        catalog: result.data.skills,
        isLoadingCatalog: false,
      });
    } catch (error) {
      set({
        isLoadingCatalog: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  loadCategories: async () => {
    try {
      const result = await window.levante.skills.getCategories();
      if (!result.success) {
        throw new Error(result.error);
      }

      set({ categories: result.data.categories });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  loadInstalled: async () => {
    set({ isLoadingInstalled: true, error: null });

    try {
      const result = await window.levante.skills.listInstalled();
      if (!result.success) {
        throw new Error(result.error);
      }

      const installed = result.data;
      set({
        installedSkills: installed,
        installedIds: new Set(installed.map((item) => item.id)),
        isLoadingInstalled: false,
      });
    } catch (error) {
      set({
        isLoadingInstalled: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  installSkill: async (skill: SkillDescriptor) => {
    const result = await window.levante.skills.install(skill);
    if (!result.success) {
      throw new Error(result.error);
    }

    const installed = result.data;

    set((state) => {
      const already = state.installedSkills.some((s) => s.id === installed.id);
      const nextList = already
        ? state.installedSkills.map((s) => (s.id === installed.id ? installed : s))
        : [...state.installedSkills, installed];

      return {
        installedSkills: nextList,
        installedIds: new Set(nextList.map((s) => s.id)),
      };
    });
  },

  uninstallSkill: async (skillId: string) => {
    const result = await window.levante.skills.uninstall(skillId);
    if (!result.success) {
      throw new Error(result.error);
    }

    set((state) => {
      const nextList = state.installedSkills.filter((s) => s.id !== skillId);
      return {
        installedSkills: nextList,
        installedIds: new Set(nextList.map((s) => s.id)),
      };
    });
  },

  isInstalled: (skillId: string) => get().installedIds.has(skillId),
}));
```

---

## Paso 10. Componentes UI

Crear carpeta `src/renderer/components/skills/`.

## 10.1 `SkillCard.tsx`

```tsx
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Download, Trash2, ExternalLink } from 'lucide-react'
import type { SkillDescriptor } from '../../../types/skills'

interface SkillCardProps {
  skill: SkillDescriptor
  isInstalled: boolean
  isLoading?: boolean
  onInstall: (skill: SkillDescriptor) => void
  onUninstall: (skillId: string) => void
  onViewDetails: (skill: SkillDescriptor) => void
}

export function SkillCard({
  skill,
  isInstalled,
  isLoading,
  onInstall,
  onUninstall,
  onViewDetails,
}: SkillCardProps) {
  return (
    <Card className="flex flex-col hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-sm leading-tight">{skill.name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{skill.category}</p>
          </div>
          {skill.version && (
            <span className="text-xs text-muted-foreground shrink-0">v{skill.version}</span>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1 pb-2">
        <p className="text-xs text-muted-foreground line-clamp-2">{skill.description}</p>

        {skill.tags && skill.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {skill.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs px-1.5 py-0">
                {tag}
              </Badge>
            ))}
            {skill.tags.length > 3 && (
              <span className="text-xs text-muted-foreground">+{skill.tags.length - 3}</span>
            )}
          </div>
        )}
      </CardContent>

      <CardFooter className="pt-2 gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="flex-1 text-xs"
          onClick={() => onViewDetails(skill)}
        >
          <ExternalLink className="h-3 w-3 mr-1" />
          Details
        </Button>

        {isInstalled ? (
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-xs text-destructive hover:text-destructive"
            onClick={() => onUninstall(skill.id)}
            disabled={isLoading}
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Remove
          </Button>
        ) : (
          <Button
            size="sm"
            className="flex-1 text-xs"
            onClick={() => onInstall(skill)}
            disabled={isLoading}
          >
            <Download className="h-3 w-3 mr-1" />
            Install
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
```

## 10.2 `SkillCategoryFilter.tsx`

```tsx
import { Button } from '@/components/ui/button'
import type { SkillCategory } from '../../../types/skills'

interface SkillCategoryFilterProps {
  categories: SkillCategory[]
  selectedCategory: string | null
  onSelect: (category: string | null) => void
}

export function SkillCategoryFilter({
  categories,
  selectedCategory,
  onSelect,
}: SkillCategoryFilterProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant={selectedCategory === null ? 'default' : 'outline'}
        size="sm"
        onClick={() => onSelect(null)}
        className="text-xs"
      >
        All
      </Button>

      {categories.map((cat) => (
        <Button
          key={cat.category}
          variant={selectedCategory === cat.category ? 'default' : 'outline'}
          size="sm"
          onClick={() => onSelect(cat.category)}
          className="text-xs"
        >
          {cat.displayName}
          <span className="ml-1 text-muted-foreground">({cat.count})</span>
        </Button>
      ))}
    </div>
  )
}
```

## 10.3 `SkillDetailsModal.tsx`

```tsx
import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Download, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { SkillDescriptor } from '../../../types/skills'
import { useSkillsStore } from '@/stores/skillsStore'

interface SkillDetailsModalProps {
  skill: SkillDescriptor | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SkillDetailsModal({ skill, open, onOpenChange }: SkillDetailsModalProps) {
  const [isProcessing, setIsProcessing] = useState(false)
  const { isInstalled, installSkill, uninstallSkill } = useSkillsStore()

  if (!skill) return null

  const installed = isInstalled(skill.id)

  const handleInstall = async () => {
    setIsProcessing(true)
    try {
      await installSkill(skill)
      toast.success(`Skill "${skill.name}" installed`)
      onOpenChange(false)
    } catch (err: any) {
      toast.error(`Failed to install: ${err.message}`)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleUninstall = async () => {
    setIsProcessing(true)
    try {
      await uninstallSkill(skill.id)
      toast.success(`Skill "${skill.name}" removed`)
      onOpenChange(false)
    } catch (err: any) {
      toast.error(`Failed to remove: ${err.message}`)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {skill.name}
            {skill.version && (
              <span className="text-sm font-normal text-muted-foreground">v{skill.version}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 flex-1 overflow-hidden">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-muted-foreground">Category: </span>
              <span>{skill.category}</span>
            </div>
            {skill.author && (
              <div>
                <span className="text-muted-foreground">Author: </span>
                <span>{skill.author}</span>
              </div>
            )}
            {skill.model && (
              <div>
                <span className="text-muted-foreground">Model: </span>
                <span>{skill.model}</span>
              </div>
            )}
            {skill.allowedTools && (
              <div>
                <span className="text-muted-foreground">Tools: </span>
                <span className="text-xs">{skill.allowedTools}</span>
              </div>
            )}
          </div>

          <p className="text-sm text-muted-foreground">{skill.description}</p>

          {skill.tags && skill.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {skill.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          <Separator />

          <ScrollArea className="flex-1 min-h-0">
            <pre className="text-xs font-mono whitespace-pre-wrap bg-muted p-3 rounded-md">
              {skill.content}
            </pre>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>

          {installed ? (
            <Button
              variant="destructive"
              onClick={handleUninstall}
              disabled={isProcessing}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Remove Skill
            </Button>
          ) : (
            <Button onClick={handleInstall} disabled={isProcessing}>
              <Download className="h-4 w-4 mr-2" />
              {isProcessing ? 'Installing...' : 'Install Skill'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

## 10.4 `SkillInstallDeepLinkModal.tsx`

```tsx
import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import type { SkillDescriptor } from '../../../types/skills'
import { useSkillsStore } from '@/stores/skillsStore'

interface SkillInstallDeepLinkModalProps {
  skill: SkillDescriptor | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SkillInstallDeepLinkModal({
  skill,
  open,
  onOpenChange,
}: SkillInstallDeepLinkModalProps) {
  const [isInstalling, setIsInstalling] = useState(false)
  const { installSkill, isInstalled } = useSkillsStore()

  if (!skill) return null

  const alreadyInstalled = isInstalled(skill.id)

  const handleInstall = async () => {
    setIsInstalling(true)
    try {
      await installSkill(skill)
      toast.success(`Skill "${skill.name}" installed successfully`)
      onOpenChange(false)
    } catch (err: any) {
      toast.error(`Failed to install skill: ${err.message}`)
    } finally {
      setIsInstalling(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Install Skill</DialogTitle>
          <DialogDescription>
            You are about to install the following skill into Levante.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg border p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{skill.name}</h3>
              {skill.version && (
                <span className="text-xs text-muted-foreground">v{skill.version}</span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{skill.description}</p>

            <div className="text-xs text-muted-foreground space-y-1">
              <div>Category: <span className="text-foreground">{skill.category}</span></div>
              {skill.author && (
                <div>Author: <span className="text-foreground">{skill.author}</span></div>
              )}
              {skill.model && (
                <div>Model: <span className="text-foreground">{skill.model}</span></div>
              )}
            </div>

            {skill.tags && skill.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {skill.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {alreadyInstalled && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              This skill is already installed. Proceeding will overwrite it.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleInstall} disabled={isInstalling}>
            <Download className="h-4 w-4 mr-2" />
            {isInstalling ? 'Installing...' : 'Install'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

---

## Paso 11. Pagina Skills

Crear `src/renderer/pages/SkillsPage.tsx`.

```tsx
import { useEffect, useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { Search } from 'lucide-react'
import { toast } from 'sonner'
import { SkillCard } from '@/components/skills/SkillCard'
import { SkillCategoryFilter } from '@/components/skills/SkillCategoryFilter'
import { SkillDetailsModal } from '@/components/skills/SkillDetailsModal'
import { useSkillsStore } from '@/stores/skillsStore'
import type { SkillDescriptor } from '../../types/skills'

const SkillsPage = () => {
  const {
    catalog,
    categories,
    isLoadingCatalog,
    error,
    loadCatalog,
    loadCategories,
    loadInstalled,
    isInstalled,
    installSkill,
    uninstallSkill,
  } = useSkillsStore()

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [selectedSkill, setSelectedSkill] = useState<SkillDescriptor | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadCatalog()
    loadCategories()
    loadInstalled()
  }, [loadCatalog, loadCategories, loadInstalled])

  const filteredSkills = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()

    return catalog.filter((skill) => {
      if (selectedCategory && skill.category !== selectedCategory) return false
      if (!q) return true

      return (
        skill.name.toLowerCase().includes(q) ||
        skill.description.toLowerCase().includes(q) ||
        skill.tags?.some((tag) => tag.toLowerCase().includes(q))
      )
    })
  }, [catalog, searchQuery, selectedCategory])

  const handleInstall = async (skill: SkillDescriptor) => {
    setProcessingIds((prev) => new Set(prev).add(skill.id))

    try {
      await installSkill(skill)
      toast.success(`Skill "${skill.name}" installed`)
    } catch (err: any) {
      toast.error(`Failed to install: ${err.message}`)
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev)
        next.delete(skill.id)
        return next
      })
    }
  }

  const handleUninstall = async (skillId: string) => {
    setProcessingIds((prev) => new Set(prev).add(skillId))

    try {
      await uninstallSkill(skillId)
      toast.success('Skill removed')
    } catch (err: any) {
      toast.error(`Failed to remove: ${err.message}`)
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev)
        next.delete(skillId)
        return next
      })
    }
  }

  const handleViewDetails = (skill: SkillDescriptor) => {
    setSelectedSkill(skill)
    setDetailsOpen(true)
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-6 py-4 border-b space-y-3 shrink-0">
        <div>
          <h1 className="text-xl font-semibold">Skills Store</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Browse and install AI agent skills
          </p>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search skills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <SkillCategoryFilter
          categories={categories}
          selectedCategory={selectedCategory}
          onSelect={setSelectedCategory}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {isLoadingCatalog ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-48 rounded-lg" />
            ))}
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            {searchQuery || selectedCategory
              ? 'No skills match your search.'
              : 'No skills available.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredSkills.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                isInstalled={isInstalled(skill.id)}
                isLoading={processingIds.has(skill.id)}
                onInstall={handleInstall}
                onUninstall={handleUninstall}
                onViewDetails={handleViewDetails}
              />
            ))}
          </div>
        )}
      </div>

      <SkillDetailsModal
        skill={selectedSkill}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </div>
  )
}

export default SkillsPage
```

---

## Paso 12. Integrar pagina y deep link en App.tsx

Modificar `src/renderer/App.tsx`.

### 12.1 Imports

Agregar:

```ts
import SkillsPage from '@/pages/SkillsPage'
import { SkillInstallDeepLinkModal } from '@/components/skills/SkillInstallDeepLinkModal'
import type { SkillDescriptor } from '../types/skills'
import { useSkillsStore } from '@/stores/skillsStore'
```

### 12.2 Estado para modal deep link de skills

Agregar junto a otros estados de modal:

```ts
const [skillDeepLinkData, setSkillDeepLinkData] = useState<SkillDescriptor | null>(null)
const [skillDeepLinkOpen, setSkillDeepLinkOpen] = useState(false)
```

### 12.3 Extender handler `onDeepLink`

Dentro del `useEffect` existente de deep links, agregar rama:

```ts
} else if (action.type === 'skill-install') {
  setCurrentPage('skills')

  const { skillId } = action.data as { skillId: string }

  const store = useSkillsStore.getState()
  await Promise.all([store.loadCatalog(), store.loadInstalled()])

  const skill = useSkillsStore.getState().catalog.find((s) => s.id === skillId)

  if (!skill) {
    toast.error('Skill not found', {
      description: `The skill ${skillId} does not exist in the current catalog`,
      duration: 5000,
    })
    return
  }

  setSkillDeepLinkData(skill)
  setSkillDeepLinkOpen(true)
}
```

### 12.4 `getPageTitle()`

Agregar caso:

```ts
case 'skills':
  return 'Skills Store'
```

### 12.5 `renderPage()`

Agregar caso:

```ts
case 'skills':
  return <SkillsPage />
```

### 12.6 Renderizar modal de deep link skills

En el JSX raiz (donde estan `MCPDeepLinkModal` y `AnnouncementModal`), agregar:

```tsx
<SkillInstallDeepLinkModal
  skill={skillDeepLinkData}
  open={skillDeepLinkOpen}
  onOpenChange={setSkillDeepLinkOpen}
/>
```

---

## Paso 13. Navegacion en sidebar (MainLayout)

Modificar `src/renderer/components/layout/MainLayout.tsx`.

### 13.1 Import icono

Agregar `Sparkles` al import de `lucide-react`.

### 13.2 Nuevo boton

Dentro de `SidebarFooter` -> `SidebarMenu`, agregar item:

```tsx
<SidebarMenuItem>
  <SidebarMenuButton
    onClick={() => onPageChange?.('skills')}
    isActive={currentPage === 'skills'}
  >
    <Sparkles className="w-4 h-4" />
    {t('navigation.skills')}
  </SidebarMenuButton>
</SidebarMenuItem>
```

Ubicarlo junto a `store/model/settings`.

---

## Paso 14. i18n minimo para navegacion

Modificar `src/renderer/locales/en/common.json`.

Agregar en `navigation`:

```json
"skills": "Skills"
```

Modificar `src/renderer/locales/es/common.json`.

Agregar en `navigation`:

```json
"skills": "Skills"
```

Nota:

- Si quieres traducirlo: `"Habilidades"`.
- Mantener coherencia con naming de producto.

---

## Paso 15. Checklist de wiring final (obligatorio)

Antes de validar, comprobar:

1. `src/main/lifecycle/initialization.ts` importa y llama `setupSkillsHandlers()`.
2. `src/preload/preload.ts` incluye `skillsApi` en imports, interfaz y objeto `api`.
3. `src/preload/types/index.ts` y `src/main/services/deepLinkService.ts` incluyen `skill-install`.
4. `src/renderer/App.tsx` tiene:
   - import de `SkillsPage`
   - case `'skills'` en title/render
   - branch `action.type === 'skill-install'`
   - render de `SkillInstallDeepLinkModal`
5. `src/renderer/components/layout/MainLayout.tsx` tiene boton `skills`.

---

## 6. Validacion tecnica

## 6.1 Verificaciones automaticas

Ejecutar:

```bash
pnpm typecheck
pnpm lint
```

Si hay suite disponible sin impacto alto de tiempo:

```bash
pnpm test
```

## 6.2 Pruebas manuales obligatorias

### Caso A. Carga de catalogo

1. Abrir app.
2. Ir a pagina `Skills`.
3. Confirmar que renderiza listado.
4. Cerrar/reabrir app y confirmar que usa cache (sin error visual).

### Caso B. Instalacion y desinstalacion

1. Instalar una skill desde card.
2. Verificar archivo creado en `~/levante/skills/{category}/{name}.md`.
3. Desinstalar skill.
4. Verificar que el archivo desaparece.

### Caso C. Fallback offline

1. Cargar catalogo online una vez.
2. Cortar red.
3. Reabrir pagina Skills.
4. Debe mostrar catalogo desde cache (aunque stale).

### Caso D. Deep link

1. Ejecutar en macOS:

```bash
open 'levante://skill/install?id=development%2Freact-patterns'
```

2. App debe:
   - enfocarse
   - navegar a Skills
   - abrir modal de confirmacion
3. Confirmar instalacion.

### Caso E. Deep link invalido

1. Probar:

```bash
open 'levante://skill/install?id=invalid'
```

2. No debe crashear ni instalar nada.

---

## 7. Definicion de Done (DoD)

Se considera completado solo si se cumple todo:

1. Build/typecheck/lint en verde.
2. Skills page navegable desde sidebar.
3. Instalacion/desinstalacion funcional y persistida en disco.
4. Catalogo con cache + fallback offline.
5. Deep link `skill/install` funcional con modal de confirmacion.
6. Sin regressions en deep links existentes (`mcp-add`, `mcp-configure`, `chat-new`).

---

## 8. Riesgos y mitigaciones

1. **Riesgo**: endpoint remoto cambia schema.
   **Mitigacion**: validar `id/name/category/content` antes de usar cada skill.

2. **Riesgo**: nombres con caracteres no validos rompen filesystem.
   **Mitigacion**: sanitizacion obligatoria de segmentos de path.

3. **Riesgo**: desincronizacion entre id y nombre de archivo.
   **Mitigacion**: usar siempre `skill.id` para construir ruta.

4. **Riesgo**: deep link malformado.
   **Mitigacion**: regex estricta `category/name` + early return.

5. **Riesgo**: rompe preload por tipado incompleto.
   **Mitigacion**: actualizar interfaz `LevanteAPI` antes de exponer `skillsApi`.

---

## 9. Rollback

Si hay problema en produccion:

1. Quitar boton `skills` de `MainLayout`.
2. Quitar cases `'skills'` en `App.tsx`.
3. Mantener codigo de servicio/IPC si no interfiere, o desregistrar en `initialization.ts`.
4. Quitar branch `skill-install` del parser deep link.

Rollback minimo seguro:

- remover wiring UI + parser branch + registro IPC.

---

## 10. Orden recomendado de commits

1. `feat(skills): add shared types and main service`
2. `feat(skills): add ipc handlers and preload bridge`
3. `feat(skills): add renderer store and skills page UI`
4. `feat(skills): add deep-link install flow and modal`
5. `chore(i18n): add skills navigation label`
6. `docs(skills): finalize runbook and validation checklist`

---

## 11. Mapa rapido de dependencias

```text
types/skills.ts
  -> main/services/skillsService.ts
  -> preload/api/skills.ts
  -> renderer/stores/skillsStore.ts
  -> renderer/components/skills/*
  -> renderer/pages/SkillsPage.tsx

main/services/skillsService.ts
  -> main/ipc/skillsHandlers.ts

main/ipc/skillsHandlers.ts
  -> main/lifecycle/initialization.ts

preload/api/skills.ts
  -> preload/preload.ts

deepLinkService.ts + preload/types/index.ts
  -> renderer/App.tsx (handler skill-install)

MainLayout.tsx + App.tsx
  -> navegacion final
```

---

## 12. Nota final para IA ejecutora

No improvisar estructura fuera de este runbook.

Orden obligatorio de ejecucion:

1. Main backend (types/service/ipc/registration)
2. Preload bridge y tipado
3. Deep link typing/parsing
4. Renderer store y componentes
5. Integracion App/MainLayout/i18n
6. Validacion automatica + pruebas manuales

Si algun paso falla por tipado, corregir antes de avanzar al siguiente.
