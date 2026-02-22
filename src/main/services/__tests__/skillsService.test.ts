import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Mock electron
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/levante-test'),
  },
}));

// Mock logger
vi.mock('../logging', () => ({
  getLogger: () => ({
    core: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    ipc: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }),
}));

// Mock directoryService
const mockGlobalSkillsDir = path.join(os.tmpdir(), 'levante-test-skills-global');
vi.mock('../directoryService', () => ({
  directoryService: {
    getSubdirPath: vi.fn(() => mockGlobalSkillsDir),
    ensureBaseDir: vi.fn(),
  },
}));

// Mock projectService via dynamic import
vi.mock('../projectService', () => ({
  projectService: {
    getProject: vi.fn(),
    listProjects: vi.fn(),
  },
}));

import { SkillsService } from '../skillsService';
import type { SkillBundleResponse } from '../../../types/skills';

function makeSkillMd(id: string, name: string, description: string, category: string, content: string): string {
  return `---\nid: "${id}"\nname: "${name}"\ndescription: "${description}"\ncategory: "${category}"\n---\n${content}`;
}

const mockBundle: SkillBundleResponse = {
  id: 'test/skill-one',
  name: 'Skill One',
  description: 'A test skill',
  category: 'test',
  content: '# Skill One\nDoes stuff.',
  files: {
    'SKILL.md': makeSkillMd('test/skill-one', 'Skill One', 'A test skill', 'test', '# Skill One\nDoes stuff.'),
  },
};

async function cleanDir(dir: string) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

describe('SkillsService', () => {
  let service: SkillsService;
  let tmpProjectCwd: string;

  beforeEach(async () => {
    service = new SkillsService();
    await cleanDir(mockGlobalSkillsDir);
    await fs.mkdir(mockGlobalSkillsDir, { recursive: true });
    tmpProjectCwd = path.join(os.tmpdir(), `levante-test-project-${Date.now()}`);
    await fs.mkdir(tmpProjectCwd, { recursive: true });

    // Reset projectService mock
    const { projectService } = await import('../projectService');
    vi.mocked(projectService.getProject).mockResolvedValue({
      success: true,
      data: {
        id: 'proj_test_1',
        name: 'Test Project',
        cwd: tmpProjectCwd,
        description: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      },
    });
    vi.mocked(projectService.listProjects).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'proj_test_1',
          name: 'Test Project',
          cwd: tmpProjectCwd,
          description: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ],
    });
  });

  afterEach(async () => {
    await cleanDir(mockGlobalSkillsDir);
    await cleanDir(tmpProjectCwd);
  });

  describe('installSkill', () => {
    it('installs globally and returns scope=global', async () => {
      const result = await service.installSkill(mockBundle, { scope: 'global' });

      expect(result.scope).toBe('global');
      expect(result.scopedKey).toBe('global:global:test/skill-one');
      expect(result.projectId).toBeUndefined();
      expect(result.filePath).toContain(mockGlobalSkillsDir);

      // SKILL.md should exist inside skill directory
      const skillMdPath = path.join(mockGlobalSkillsDir, 'skill-one', 'SKILL.md');
      await expect(fs.access(skillMdPath)).resolves.toBeUndefined();
    });

    it('installs in project and returns scope=project', async () => {
      const result = await service.installSkill(mockBundle, {
        scope: 'project',
        projectId: 'proj_test_1',
      });

      expect(result.scope).toBe('project');
      expect(result.projectId).toBe('proj_test_1');
      expect(result.projectName).toBe('Test Project');
      expect(result.scopedKey).toBe('project:proj_test_1:test/skill-one');
      expect(result.filePath).toContain(tmpProjectCwd);

      // SKILL.md should exist inside skill directory
      const skillMdPath = path.join(tmpProjectCwd, '.levante', 'skills', 'skill-one', 'SKILL.md');
      await expect(fs.access(skillMdPath)).resolves.toBeUndefined();
    });

    it('throws if scope=project but no projectId', async () => {
      await expect(
        service.installSkill(mockBundle, { scope: 'project' })
      ).rejects.toThrow('projectId is required');
    });

    it('throws if project has no cwd', async () => {
      const { projectService } = await import('../projectService');
      vi.mocked(projectService.getProject).mockResolvedValue({
        success: true,
        data: {
          id: 'proj_nocwd',
          name: 'No CWD Project',
          cwd: null,
          description: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      });

      await expect(
        service.installSkill(mockBundle, { scope: 'project', projectId: 'proj_nocwd' })
      ).rejects.toThrow('working directory');
    });
  });

  describe('uninstallSkill', () => {
    it('uninstalls global without touching project installation', async () => {
      // Install in both scopes
      await service.installSkill(mockBundle, { scope: 'global' });
      await service.installSkill(mockBundle, { scope: 'project', projectId: 'proj_test_1' });

      // Uninstall global
      await service.uninstallSkill(mockBundle.id, { scope: 'global' });

      // Global skill dir should be gone
      const globalPath = path.join(mockGlobalSkillsDir, 'skill-one', 'SKILL.md');
      await expect(fs.access(globalPath)).rejects.toThrow();

      // Project skill dir should still exist
      const projectPath = path.join(tmpProjectCwd, '.levante', 'skills', 'skill-one', 'SKILL.md');
      await expect(fs.access(projectPath)).resolves.toBeUndefined();
    });

    it('uninstalls project without touching global installation', async () => {
      await service.installSkill(mockBundle, { scope: 'global' });
      await service.installSkill(mockBundle, { scope: 'project', projectId: 'proj_test_1' });

      await service.uninstallSkill(mockBundle.id, { scope: 'project', projectId: 'proj_test_1' });

      // Project skill dir should be gone
      const projectPath = path.join(tmpProjectCwd, '.levante', 'skills', 'skill-one', 'SKILL.md');
      await expect(fs.access(projectPath)).rejects.toThrow();

      // Global skill dir should still exist
      const globalPath = path.join(mockGlobalSkillsDir, 'skill-one', 'SKILL.md');
      await expect(fs.access(globalPath)).resolves.toBeUndefined();
    });
  });

  describe('listInstalledSkills', () => {
    it('mode=global returns only global skills', async () => {
      await service.installSkill(mockBundle, { scope: 'global' });
      await service.installSkill(mockBundle, { scope: 'project', projectId: 'proj_test_1' });

      const result = await service.listInstalledSkills({ mode: 'global' });

      expect(result).toHaveLength(1);
      expect(result[0].scope).toBe('global');
    });

    it('mode=project-merged merges and project overrides global', async () => {
      const globalBundle: SkillBundleResponse = {
        ...mockBundle,
        description: 'Global version',
        files: { 'SKILL.md': makeSkillMd('test/skill-one', 'Skill One', 'Global version', 'test', '# Skill') },
      };
      const projectBundle: SkillBundleResponse = {
        ...mockBundle,
        description: 'Project version',
        files: { 'SKILL.md': makeSkillMd('test/skill-one', 'Skill One', 'Project version', 'test', '# Skill') },
      };

      await service.installSkill(globalBundle, { scope: 'global' });
      await service.installSkill(projectBundle, { scope: 'project', projectId: 'proj_test_1' });

      const result = await service.listInstalledSkills({
        mode: 'project-merged',
        projectId: 'proj_test_1',
      });

      expect(result).toHaveLength(1);
      expect(result[0].scope).toBe('project');
      expect(result[0].description).toBe('Project version');
    });

    it('mode=all-scopes returns all instances without cross-scope dedupe', async () => {
      await service.installSkill(mockBundle, { scope: 'global' });
      await service.installSkill(mockBundle, { scope: 'project', projectId: 'proj_test_1' });

      const result = await service.listInstalledSkills({ mode: 'all-scopes' });

      expect(result).toHaveLength(2);
      expect(result.some((s) => s.scope === 'global')).toBe(true);
      expect(result.some((s) => s.scope === 'project')).toBe(true);
    });

    it('mode=project-merged requires projectId', async () => {
      await expect(
        service.listInstalledSkills({ mode: 'project-merged' })
      ).rejects.toThrow('projectId is required');
    });
  });
});
