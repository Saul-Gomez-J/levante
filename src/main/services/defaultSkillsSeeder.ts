import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getLogger } from './logging';
import { directoryService } from './directoryService';
import { skillsService } from './skillsService';
import type { SkillBundleResponse } from '../../types/skills';

const logger = getLogger();

interface DefaultSkillEntry {
  id: string;
  name: string;
}

const DEFAULT_SKILLS: DefaultSkillEntry[] = [
  { id: 'custom/skill-creator', name: 'skill-creator' },
  { id: 'custom/pdf', name: 'pdf' },
];

function getBundledSkillsRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'default-skills');
  }

  return path.join(__dirname, '../../resources/default-skills');
}

function getBundledSkillDir(skillName: string): string {
  return path.join(getBundledSkillsRoot(), skillName);
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

function compareVersions(versionA: string, versionB: string): number {
  const normalize = (version: string): number[] =>
    version
      .replace(/^v/, '')
      .split('.')
      .map((part) => {
        const parsed = Number.parseInt(part, 10);
        return Number.isFinite(parsed) ? parsed : 0;
      });

  const partsA = normalize(versionA);
  const partsB = normalize(versionB);
  const length = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < length; i++) {
    const a = partsA[i] ?? 0;
    const b = partsB[i] ?? 0;

    if (a > b) return 1;
    if (a < b) return -1;
  }

  return 0;
}

async function collectFiles(
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

async function getInstalledVersion(skillName: string): Promise<string | null> {
  const globalSkillsDir = directoryService.getSubdirPath('skills');
  const skillMdPath = path.join(globalSkillsDir, skillName, 'skill.md');

  try {
    const raw = await fs.readFile(skillMdPath, 'utf-8');
    const { meta } = parseFrontmatter(raw);
    return meta['version'] ?? null;
  } catch {
    return null;
  }
}

async function buildBundledSkillBundle(
  skillDir: string,
  entry: DefaultSkillEntry
): Promise<SkillBundleResponse> {
  const manifestPath = path.join(skillDir, 'SKILL.md');
  const raw = await fs.readFile(manifestPath, 'utf-8');
  const { meta, content } = parseFrontmatter(raw);

  const version = meta['version']?.trim();
  if (!version) {
    throw new Error(`Bundled skill "${entry.name}" is missing version`);
  }

  return {
    id: entry.id,
    name: meta['name'] ?? entry.name,
    description: meta['description'] ?? '',
    category: 'custom',
    version,
    license: meta['license'],
    allowedTools: meta['allowed-tools'],
    model: meta['model'],
    userInvocable: true,
    content,
    files: await collectFiles(skillDir, manifestPath),
  };
}

async function seedSkill(entry: DefaultSkillEntry): Promise<void> {
  const skillDir = getBundledSkillDir(entry.name);

  try {
    await fs.access(skillDir);
  } catch {
    logger.core.warn('Bundled default skill not found, skipping seeding', {
      skillDir,
      skillId: entry.id,
    });
    return;
  }

  const bundle = await buildBundledSkillBundle(skillDir, entry);
  const installedVersion = await getInstalledVersion(entry.name);

  if (installedVersion && compareVersions(bundle.version!, installedVersion) <= 0) {
    logger.core.debug('Default skill already installed at same or newer version', {
      skillId: bundle.id,
      installedVersion,
      bundledVersion: bundle.version,
    });
    return;
  }

  if (installedVersion) {
    await skillsService.uninstallSkill(entry.id, { scope: 'global' });
  }

  await skillsService.installSkill(bundle, { scope: 'global' });

  logger.core.info('Default skill seeded successfully', {
    skillId: bundle.id,
    version: bundle.version,
    installedVersion,
    filesCount: Object.keys(bundle.files).length,
    replacedExistingInstallation: installedVersion !== null,
  });
}

export async function seedDefaultSkills(): Promise<void> {
  for (const entry of DEFAULT_SKILLS) {
    try {
      await seedSkill(entry);
    } catch (error) {
      logger.core.error('Failed to seed default skill', {
        skillId: entry.id,
        error: error instanceof Error ? error.message : error,
      });
    }
  }
}
