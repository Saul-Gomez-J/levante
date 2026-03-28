import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const mockGlobalSkillsDir = path.join(os.tmpdir(), 'levante-default-skill-seeder-global');

const { mockInstallSkill, mockUninstallSkill, mockApp } = vi.hoisted(() => ({
  mockInstallSkill: vi.fn(),
  mockUninstallSkill: vi.fn(),
  mockApp: { isPackaged: true },
}));

vi.mock('electron', () => ({
  app: mockApp,
}));

vi.mock('../logging', () => ({
  getLogger: () => ({
    core: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }),
}));

vi.mock('../directoryService', () => ({
  directoryService: {
    getSubdirPath: vi.fn(() => mockGlobalSkillsDir),
  },
}));

vi.mock('../skillsService', () => ({
  skillsService: {
    installSkill: mockInstallSkill,
    uninstallSkill: mockUninstallSkill,
  },
}));

import { seedDefaultSkills } from '../defaultSkillsSeeder';

async function cleanDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

async function writeBundledSkill(resourcesPath: string, version: string): Promise<void> {
  const skillDir = path.join(resourcesPath, 'default-skills', 'skill-creator');
  await fs.mkdir(path.join(skillDir, 'agents'), { recursive: true });

  await fs.writeFile(
    path.join(skillDir, 'SKILL.md'),
    [
      '---',
      'name: skill-creator',
      'description: Create and improve skills.',
      `version: "${version}"`,
      'license: Apache-2.0',
      '---',
      '',
      '# Skill Creator',
    ].join('\n'),
    'utf-8'
  );

  await fs.writeFile(path.join(skillDir, 'LICENSE.txt'), 'Apache License', 'utf-8');
  await fs.writeFile(path.join(skillDir, 'agents', 'analyzer.md'), '# Analyzer', 'utf-8');
}

async function writeInstalledSkill(version: string): Promise<void> {
  const skillDir = path.join(mockGlobalSkillsDir, 'skill-creator');
  await fs.mkdir(skillDir, { recursive: true });

  await fs.writeFile(
    path.join(skillDir, 'skill.md'),
    [
      '---',
      'id: "custom/skill-creator"',
      'name: "skill-creator"',
      'description: "Create and improve skills."',
      'category: "custom"',
      `version: "${version}"`,
      'installed-at: "2026-01-01T00:00:00.000Z"',
      '---',
      '',
      '# Skill Creator',
    ].join('\n'),
    'utf-8'
  );
}

describe('defaultSkillsSeeder', () => {
  let resourcesPath: string;
  let originalResourcesPath: string | undefined;

  beforeEach(async () => {
    mockInstallSkill.mockReset();
    mockUninstallSkill.mockReset();
    mockInstallSkill.mockResolvedValue({
      id: 'custom/skill-creator',
      name: 'skill-creator',
      description: 'Create and improve skills.',
      category: 'custom',
      version: '1.0.0',
      license: 'Apache-2.0',
      content: '# Skill Creator',
      files: {},
      installedAt: new Date().toISOString(),
      filePath: path.join(mockGlobalSkillsDir, 'skill-creator', 'skill.md'),
      scope: 'global',
      scopedKey: 'global:global:custom/skill-creator',
    });

    originalResourcesPath = process.resourcesPath;
    resourcesPath = await fs.mkdtemp(path.join(os.tmpdir(), 'levante-default-skills-'));
    Object.defineProperty(process, 'resourcesPath', {
      value: resourcesPath,
      configurable: true,
    });

    await cleanDir(mockGlobalSkillsDir);
    await fs.mkdir(mockGlobalSkillsDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanDir(resourcesPath);
    await cleanDir(mockGlobalSkillsDir);

    if (originalResourcesPath === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete (process as unknown as Record<string, unknown>).resourcesPath;
    } else {
      Object.defineProperty(process, 'resourcesPath', {
        value: originalResourcesPath,
        configurable: true,
      });
    }
  });

  it('installs the bundled skill when it is not installed yet', async () => {
    await writeBundledSkill(resourcesPath, '1.0.0');

    await seedDefaultSkills();

    expect(mockInstallSkill).toHaveBeenCalledTimes(1);
    expect(mockInstallSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'custom/skill-creator',
        name: 'skill-creator',
        version: '1.0.0',
        license: 'Apache-2.0',
        files: expect.objectContaining({
          'LICENSE.txt': 'Apache License',
          'agents/analyzer.md': '# Analyzer',
        }),
      }),
      { scope: 'global' }
    );
  });

  it('skips installation when the installed version is the same', async () => {
    await writeBundledSkill(resourcesPath, '1.0.0');
    await writeInstalledSkill('1.0.0');

    await seedDefaultSkills();

    expect(mockInstallSkill).not.toHaveBeenCalled();
    expect(mockUninstallSkill).not.toHaveBeenCalled();
  });

  it('replaces the installed skill when the bundled version is newer', async () => {
    await writeBundledSkill(resourcesPath, '1.1.0');
    await writeInstalledSkill('1.0.0');

    await seedDefaultSkills();

    expect(mockUninstallSkill).toHaveBeenCalledTimes(1);
    expect(mockUninstallSkill).toHaveBeenCalledWith('custom/skill-creator', { scope: 'global' });
    expect(mockInstallSkill).toHaveBeenCalledTimes(1);
    expect(mockInstallSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        version: '1.1.0',
      }),
      { scope: 'global' }
    );
  });

  it('removes stale files on upgrade by uninstalling before reinstalling', async () => {
    await writeBundledSkill(resourcesPath, '1.1.0');
    await writeInstalledSkill('1.0.0');

    await seedDefaultSkills();

    expect(mockUninstallSkill.mock.invocationCallOrder[0]).toBeLessThan(
      mockInstallSkill.mock.invocationCallOrder[0]
    );
  });
});
