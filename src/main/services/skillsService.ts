import { app } from 'electron';
import extract from 'extract-zip';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getLogger } from './logging';
import { directoryService } from './directoryService';
import { envConfig } from './envConfig';
import type {
  SkillDescriptor,
  SkillBundleResponse,
  SkillsCatalogResponse,
  SkillCategory,
  InstalledSkill,
  SkillScope,
  InstallSkillOptions,
  UninstallSkillOptions,
  ListInstalledSkillsOptions,
  SetUserInvocableOptions,
} from '../../types/skills';

const logger = getLogger();

const SERVICES_HOST = envConfig.servicesHost;
const CATALOG_ENDPOINT = '/api/skills.json';
const BUNDLE_ENDPOINT = (skillId: string) => {
  if (skillId.includes('/')) {
    const [category, name] = skillId.split('/');
    return `/api/skills/${encodeURIComponent(category)}/${encodeURIComponent(name)}/bundle`;
  }
  return `/api/skills/${encodeURIComponent(skillId)}/bundle`;
};
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

interface CacheEntry {
  timestamp: number;
  data: SkillsCatalogResponse;
}

function getCachePath(): string {
  return path.join(app.getPath('userData'), 'skills-cache.json');
}

function getGlobalSkillsDir(): string {
  return directoryService.getSubdirPath('skills');
}

function getProjectSkillsDir(projectCwd: string): string {
  return path.join(projectCwd, '.levante', 'skills');
}

function buildScopedKey(scope: SkillScope, skillId: string, projectId?: string): string {
  return `${scope}:${scope === 'project' ? projectId ?? 'unknown' : 'global'}:${skillId}`;
}

async function resolveProjectForScope(projectId: string): Promise<{ id: string; name: string; cwd: string }> {
  const { projectService } = await import('./projectService');
  const result = await projectService.getProject(projectId);

  if (!result.success || !result.data) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const project = result.data;

  if (!project.cwd || project.cwd.trim() === '') {
    throw new Error(`Project "${project.name}" does not have a working directory configured`);
  }

  return {
    id: project.id,
    name: project.name,
    cwd: project.cwd,
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

function buildSkillDir(baseDir: string, skillId: string): { name: string; skillDir: string } {
  const decoded = decodeURIComponent(skillId).trim();
  const parts = decoded.split('/');
  const leafName = parts[parts.length - 1] || decoded;
  const name = sanitizePathSegment(leafName);
  if (!name) throw new Error(`Invalid skill id after sanitization: ${skillId}`);
  return { name, skillDir: path.join(baseDir, name) };
}

function buildSkillFile(bundle: SkillBundleResponse, installedAt: string): string {
  const lines: string[] = ['---'];
  lines.push(`id: ${JSON.stringify(bundle.id)}`);
  lines.push(`name: ${JSON.stringify(bundle.name)}`);
  lines.push(`description: ${JSON.stringify(bundle.description ?? '')}`);
  lines.push(`category: ${JSON.stringify(bundle.category ?? '')}`);
  if (bundle.version)     lines.push(`version: ${JSON.stringify(bundle.version)}`);
  if (bundle.author)      lines.push(`author: ${JSON.stringify(bundle.author)}`);
  if (bundle.license)     lines.push(`license: ${JSON.stringify(bundle.license)}`);
  if (bundle.allowedTools) lines.push(`allowed-tools: ${JSON.stringify(bundle.allowedTools)}`);
  if (bundle.model)       lines.push(`model: ${JSON.stringify(bundle.model)}`);
  if (bundle.userInvocable !== undefined) lines.push(`user-invocable: "${bundle.userInvocable}"`);
  lines.push(`installed-at: ${JSON.stringify(installedAt)}`);
  lines.push('---');
  lines.push('');
  lines.push(bundle.content ?? '');
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

function updateFrontmatterBoolean(raw: string, key: string, value: boolean): string {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error('Invalid skill file: missing YAML frontmatter');
  }

  const [, frontmatter, content] = match;
  const lines = frontmatter.split('\n');
  const newLine = `${key}: "${value}"`;

  let replaced = false;
  const updatedLines = lines.map((line) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith(`${key}:`)) {
      replaced = true;
      const indent = line.slice(0, line.length - trimmed.length);
      return `${indent}${newLine}`;
    }
    return line;
  });

  if (!replaced) {
    const installedAtIndex = updatedLines.findIndex((line) => line.trimStart().startsWith('installed-at:'));
    if (installedAtIndex >= 0) {
      updatedLines.splice(installedAtIndex, 0, newLine);
    } else {
      updatedLines.push(newLine);
    }
  }

  return `---\n${updatedLines.join('\n')}\n---\n${content}`;
}

async function readInstalledSkillFromFile(input: {
  filePath: string;
  fallbackSkillId: string;
  scope: SkillScope;
  project?: { id: string; name: string; cwd: string };
}): Promise<InstalledSkill> {
  const { filePath, fallbackSkillId, scope, project } = input;
  const raw = await fs.readFile(filePath, 'utf-8');
  const { meta, content } = parseFrontmatter(raw);

  const skillId = meta['id']?.trim() || fallbackSkillId;

  return {
    id: skillId,
    name: meta['name'] ?? skillId,
    description: meta['description'] ?? '',
    category: meta['category'] ?? '',
    author: meta['author'],
    version: meta['version'],
    license: meta['license'],
    allowedTools: meta['allowed-tools'],
    model: meta['model'],
    userInvocable: meta['user-invocable'] === undefined ? undefined : meta['user-invocable'] === 'true',
    content,
    installedAt: meta['installed-at'] ?? new Date().toISOString(),
    filePath,
    scope,
    ...(project
      ? {
          projectId: project.id,
          projectName: project.name,
          projectCwd: project.cwd,
        }
      : {}),
    scopedKey: buildScopedKey(scope, skillId, project?.id),
  };
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

interface ScanSkillsDirInput {
  dir: string;
  scope: SkillScope;
  project?: { id: string; name: string; cwd: string };
}

async function scanSkillsDir(input: ScanSkillsDirInput): Promise<InstalledSkill[]> {
  const { dir, scope, project } = input;
  const installed: InstalledSkill[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillName = entry.name.toString();
      const skillDir = path.join(dir, skillName);
      const filePath = path.join(skillDir, 'skill.md');

      try {
        const raw = await fs.readFile(filePath, 'utf-8');
        const { meta, content } = parseFrontmatter(raw);

        const skillId = meta['id']?.trim() || skillName;

        installed.push({
          id: skillId,
          name: meta['name'] ?? skillName,
          description: meta['description'] ?? '',
          category: meta['category'] ?? '',
          author: meta['author'],
          version: meta['version'],
          license: meta['license'],
          allowedTools: meta['allowed-tools'],
          model: meta['model'],
          userInvocable: meta['user-invocable'] === undefined ? undefined : meta['user-invocable'] === 'true',
          content,
          installedAt: meta['installed-at'] ?? new Date().toISOString(),
          filePath,
          scope,
          ...(project ? {
            projectId: project.id,
            projectName: project.name,
            projectCwd: project.cwd,
          } : {}),
          scopedKey: buildScopedKey(scope, skillId, project?.id),
        });
      } catch (error) {
        logger.core.warn('Failed to parse installed skill file', {
          filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch {
    // dir doesn't exist => empty list
  }

  return installed;
}

function getFrontmatterBlock(raw: string): string {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error('Invalid skill file: missing YAML frontmatter');
  }

  return match[1];
}

function extractNestedFrontmatterValue(
  frontmatter: string,
  parentKey: string,
  childKey: string
): string | undefined {
  const lines = frontmatter.split('\n');
  let insideParent = false;
  let parentIndent = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const indent = line.length - line.trimStart().length;

    if (!insideParent && trimmed === `${parentKey}:`) {
      insideParent = true;
      parentIndent = indent;
      continue;
    }

    if (!insideParent) continue;

    if (indent <= parentIndent) {
      insideParent = false;
      continue;
    }

    const idx = trimmed.indexOf(':');
    if (idx <= 0) continue;

    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    value = value.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');

    if (key === childKey) {
      return value;
    }
  }

  return undefined;
}

function buildCustomSkillBundle(rawContent: string, skillRoot: string): SkillBundleResponse {
  const { meta, content } = parseFrontmatter(rawContent);
  const frontmatter = getFrontmatterBlock(rawContent);

  const manifestId = meta['id']?.trim();
  const manifestName = meta['name']?.trim();

  if (!manifestId && !manifestName) {
    throw new Error('Skill manifest must include at least "name" or "id"');
  }

  const derivedName = manifestName || manifestId!.split('/').pop() || path.basename(skillRoot);
  const nestedAuthor = extractNestedFrontmatterValue(frontmatter, 'metadata', 'author');
  const nestedVersion = extractNestedFrontmatterValue(frontmatter, 'metadata', 'version');

  return {
    id: manifestId || `custom/${sanitizePathSegment(derivedName)}`,
    name: derivedName,
    description: meta['description'] ?? '',
    category: meta['category']?.trim() || 'custom',
    author: meta['author'] ?? nestedAuthor,
    version: meta['version'] ?? nestedVersion ?? '1.0.0',
    license: meta['license'],
    allowedTools: meta['allowed-tools'],
    model: meta['model'],
    userInvocable:
      meta['user-invocable'] === undefined ? true : meta['user-invocable'] === 'true',
    content,
    files: {},
  };
}

async function findSkillManifest(extractedDir: string): Promise<{
  manifestPath: string;
  skillRoot: string;
}> {
  for (const fileName of ['SKILL.md', 'skill.md']) {
    const candidate = path.join(extractedDir, fileName);
    try {
      await fs.access(candidate);
      return { manifestPath: candidate, skillRoot: extractedDir };
    } catch {
      // continue
    }
  }

  const entries = await fs.readdir(extractedDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === '__MACOSX') continue;

    const subDir = path.join(extractedDir, entry.name);

    for (const fileName of ['SKILL.md', 'skill.md']) {
      const candidate = path.join(subDir, fileName);
      try {
        await fs.access(candidate);
        return { manifestPath: candidate, skillRoot: subDir };
      } catch {
        // continue
      }
    }
  }

  throw new Error('No SKILL.md or skill.md found in zip archive');
}

async function collectCompanionFiles(
  rootDir: string,
  manifestPath: string
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};

  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (fullPath === manifestPath) continue;

      const relativePath = path.relative(rootDir, fullPath);
      files[relativePath] = await fs.readFile(fullPath, 'utf-8');
    }
  };

  await walk(rootDir);
  return files;
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

  async getBundle(skillId: string): Promise<SkillBundleResponse> {
    const bundle = await apiFetch<SkillBundleResponse>(BUNDLE_ENDPOINT(skillId));
    logger.core.debug('Bundle fetched', { skillId, filesCount: Object.keys(bundle?.files ?? {}).length });
    return bundle;
  }

  async installSkill(bundle: SkillBundleResponse, options: InstallSkillOptions = {}): Promise<InstalledSkill> {
    if (!bundle?.id) {
      throw new Error('Cannot install skill: missing id');
    }

    const scope: SkillScope = options.scope ?? 'global';
    let baseDir: string;
    let project: { id: string; name: string; cwd: string } | undefined;

    if (scope === 'project') {
      if (!options.projectId) {
        throw new Error('projectId is required when scope is "project"');
      }
      project = await resolveProjectForScope(options.projectId);
      baseDir = getProjectSkillsDir(project.cwd);
    } else {
      await directoryService.ensureBaseDir();
      baseDir = getGlobalSkillsDir();
    }

    const { skillDir } = buildSkillDir(baseDir, bundle.id);
    await fs.mkdir(skillDir, { recursive: true });

    // Write all files from bundle.files as-is (includes skill.md and companion files)
    const fileKeys: string[] = [];
    for (const [relativePath, content] of Object.entries(bundle.files ?? {})) {
      const segments = relativePath.split('/').map(sanitizePathSegment).filter(Boolean);
      if (segments.length === 0) continue;
      const fullPath = path.join(skillDir, ...segments);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf-8');
      fileKeys.push(relativePath);
    }

    const installedAt = new Date().toISOString();

    // Always write canonical skill.md (overwrites any skill.md that may have come from bundle.files)
    const skillMdContent = buildSkillFile(bundle, installedAt);
    await fs.writeFile(path.join(skillDir, 'skill.md'), skillMdContent, 'utf-8');

    logger.core.info('Skill installed', { skillId: bundle.id, skillDir, scope, filesCount: fileKeys.length });

    const filePath = path.join(skillDir, 'skill.md');

    return {
      ...bundle,
      installedAt,
      filePath,
      ...(fileKeys.length ? { companionDir: skillDir, fileKeys } : {}),
      scope,
      ...(project ? {
        projectId: project.id,
        projectName: project.name,
        projectCwd: project.cwd,
      } : {}),
      scopedKey: buildScopedKey(scope, bundle.id, project?.id),
    };
  }

  async installFromZip(
    zipPath: string,
    options: InstallSkillOptions = {}
  ): Promise<InstalledSkill> {
    if (!zipPath?.trim()) {
      throw new Error('zipPath is required');
    }

    const ext = path.extname(zipPath).toLowerCase();
    if (ext !== '.zip' && ext !== '.skill') {
      throw new Error('Only .zip and .skill files are supported');
    }

    await fs.access(zipPath);

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'levante-skill-'));

    try {
      await extract(zipPath, { dir: tempDir });

      const { manifestPath, skillRoot } = await findSkillManifest(tempDir);
      const rawContent = await fs.readFile(manifestPath, 'utf-8');

      const bundle = buildCustomSkillBundle(rawContent, skillRoot);
      bundle.files = await collectCompanionFiles(skillRoot, manifestPath);

      return await this.installSkill(bundle, options);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async uninstallSkill(skillId: string, options: UninstallSkillOptions): Promise<void> {
    const scope = options.scope;
    let baseDir: string;

    if (scope === 'project') {
      if (!options.projectId) {
        throw new Error('projectId is required when scope is "project"');
      }
      const project = await resolveProjectForScope(options.projectId);
      baseDir = getProjectSkillsDir(project.cwd);
    } else {
      baseDir = getGlobalSkillsDir();
    }

    const { skillDir } = buildSkillDir(baseDir, skillId);

    try {
      await fs.rm(skillDir, { recursive: true, force: true });
      logger.core.info('Skill uninstalled', { skillId, skillDir, scope });
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
      logger.core.warn('Skill directory not found during uninstall', { skillId, skillDir, scope });
    }
  }

  async setUserInvocable(
    skillId: string,
    userInvocable: boolean,
    options: SetUserInvocableOptions
  ): Promise<InstalledSkill> {
    const scope = options.scope;
    let baseDir: string;
    let project: { id: string; name: string; cwd: string } | undefined;

    if (scope === 'project') {
      if (!options.projectId) {
        throw new Error('projectId is required when scope is "project"');
      }
      project = await resolveProjectForScope(options.projectId);
      baseDir = getProjectSkillsDir(project.cwd);
    } else {
      baseDir = getGlobalSkillsDir();
    }

    const { skillDir } = buildSkillDir(baseDir, skillId);
    const filePath = path.join(skillDir, 'skill.md');

    const raw = await fs.readFile(filePath, 'utf-8');
    const updatedRaw = updateFrontmatterBoolean(raw, 'user-invocable', userInvocable);
    await fs.writeFile(filePath, updatedRaw, 'utf-8');

    logger.core.info('Skill user-invocable updated', {
      skillId,
      scope,
      projectId: project?.id,
      userInvocable,
      filePath,
    });

    return await readInstalledSkillFromFile({
      filePath,
      fallbackSkillId: skillId,
      scope,
      project,
    });
  }

  async isInstalled(skillId: string): Promise<boolean> {
    const { skillDir } = buildSkillDir(getGlobalSkillsDir(), skillId);
    try {
      await fs.access(path.join(skillDir, 'skill.md'));
      return true;
    } catch {
      return false;
    }
  }

  async listInstalledSkills(options: ListInstalledSkillsOptions = {}): Promise<InstalledSkill[]> {
    const mode = options.mode ?? 'global';

    if (mode === 'global') {
      const globalDir = getGlobalSkillsDir();
      const installed = await scanSkillsDir({ dir: globalDir, scope: 'global' });
      installed.sort((a, b) => a.id.localeCompare(b.id));
      return installed;
    }

    if (mode === 'project-merged') {
      if (!options.projectId) {
        throw new Error('projectId is required for mode "project-merged"');
      }

      const project = await resolveProjectForScope(options.projectId);
      const globalDir = getGlobalSkillsDir();
      const projectDir = getProjectSkillsDir(project.cwd);

      const [globalSkills, projectSkills] = await Promise.all([
        scanSkillsDir({ dir: globalDir, scope: 'global' }),
        scanSkillsDir({ dir: projectDir, scope: 'project', project }),
      ]);

      // Merge: project overrides global by skill.id
      const merged = new Map<string, InstalledSkill>();
      for (const skill of globalSkills) {
        merged.set(skill.id, skill);
      }
      for (const skill of projectSkills) {
        merged.set(skill.id, skill);
      }

      const result = [...merged.values()];
      result.sort((a, b) => a.id.localeCompare(b.id));
      return result;
    }

    if (mode === 'project-and-global') {
      if (!options.projectId) {
        throw new Error('projectId is required for mode "project-and-global"');
      }

      const project = await resolveProjectForScope(options.projectId);
      const globalDir = getGlobalSkillsDir();
      const projectDir = getProjectSkillsDir(project.cwd);

      const [globalSkills, projectSkills] = await Promise.all([
        scanSkillsDir({ dir: globalDir, scope: 'global' }),
        scanSkillsDir({ dir: projectDir, scope: 'project', project }),
      ]);

      const result = [...projectSkills, ...globalSkills];
      result.sort((a, b) => {
        if (a.scope !== b.scope) return a.scope === 'project' ? -1 : 1;
        return a.id.localeCompare(b.id);
      });
      return result;
    }

    if (mode === 'all-scopes') {
      const { projectService } = await import('./projectService');
      const globalDir = getGlobalSkillsDir();

      const [globalSkills, projectsResult] = await Promise.all([
        scanSkillsDir({ dir: globalDir, scope: 'global' }),
        projectService.listProjects(),
      ]);

      globalSkills.sort((a, b) => a.id.localeCompare(b.id));

      const projectSkillsArrays: InstalledSkill[] = [];

      if (projectsResult.success) {
        const projectsWithCwd = projectsResult.data.filter((p) => p.cwd && p.cwd.trim() !== '');

        for (const project of projectsWithCwd) {
          const projectDir = getProjectSkillsDir(project.cwd!);
          try {
            const skills = await scanSkillsDir({
              dir: projectDir,
              scope: 'project',
              project: { id: project.id, name: project.name, cwd: project.cwd! },
            });
            projectSkillsArrays.push(...skills);
          } catch (error) {
            logger.core.warn('Failed to scan project skills dir, continuing', {
              projectId: project.id,
              projectDir,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      // Sort project skills by projectName + id for stable order
      projectSkillsArrays.sort((a, b) => {
        const nameComp = (a.projectName ?? '').localeCompare(b.projectName ?? '');
        if (nameComp !== 0) return nameComp;
        return a.id.localeCompare(b.id);
      });

      return [...globalSkills, ...projectSkillsArrays];
    }

    return [];
  }
}

export const skillsService = new SkillsService();
