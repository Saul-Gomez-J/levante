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

const SERVICES_HOST = 'http://localhost:5180';
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
