import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from 'react';
import type { InstalledSkill } from '../../../types/skills';

// Mock window.levante
const mockLevante = {
  skills: {
    getCatalog: vi.fn(),
    getCategories: vi.fn(),
    getBundle: vi.fn(),
    install: vi.fn(),
    uninstall: vi.fn(),
    listInstalled: vi.fn(),
    isInstalled: vi.fn(),
  },
};

vi.stubGlobal('window', { levante: mockLevante });

// Import store after setting up the mock
import { useSkillsStore } from '../skillsStore';

function makeInstalledSkill(overrides: Partial<InstalledSkill>): InstalledSkill {
  const scope = overrides.scope ?? 'global';
  const projectId = overrides.projectId;
  const id = overrides.id ?? 'test/skill-one';
  const scopedKey = overrides.scopedKey ?? `${scope}:${scope === 'project' ? projectId ?? 'unknown' : 'global'}:${id}`;

  return {
    id,
    name: overrides.name ?? 'Skill One',
    description: 'A test skill',
    category: 'test',
    content: '# Skill',
    installedAt: new Date().toISOString(),
    filePath: `/some/path/${id}.md`,
    scope,
    scopedKey,
    ...overrides,
  };
}

describe('skillsStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useSkillsStore.setState({
      catalog: [],
      categories: [],
      installedSkills: [],
      installedScopedKeys: new Set(),
      isLoadingCatalog: false,
      isLoadingInstalled: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  describe('loadInstalled', () => {
    it('loads skills with all-scopes mode and builds scopedKeys set', async () => {
      const globalSkill = makeInstalledSkill({ scope: 'global' });
      const projectSkill = makeInstalledSkill({
        scope: 'project',
        projectId: 'proj_1',
        scopedKey: 'project:proj_1:test/skill-one',
      });

      mockLevante.skills.listInstalled.mockResolvedValue({
        success: true,
        data: [globalSkill, projectSkill],
      });

      await act(async () => {
        await useSkillsStore.getState().loadInstalled({ mode: 'all-scopes' });
      });

      const state = useSkillsStore.getState();
      expect(state.installedSkills).toHaveLength(2);
      expect(state.installedScopedKeys.has('global:global:test/skill-one')).toBe(true);
      expect(state.installedScopedKeys.has('project:proj_1:test/skill-one')).toBe(true);
    });
  });

  describe('installSkill', () => {
    it('upserts by scopedKey without overwriting other scope instances', async () => {
      const globalSkill = makeInstalledSkill({ scope: 'global' });
      useSkillsStore.setState({
        installedSkills: [globalSkill],
        installedScopedKeys: new Set([globalSkill.scopedKey]),
      });

      const projectSkill = makeInstalledSkill({
        scope: 'project',
        projectId: 'proj_1',
        scopedKey: 'project:proj_1:test/skill-one',
      });

      mockLevante.skills.getBundle.mockResolvedValue({ success: true, data: {} });
      mockLevante.skills.install.mockResolvedValue({ success: true, data: projectSkill });

      await act(async () => {
        await useSkillsStore.getState().installSkill(
          { id: 'test/skill-one', name: 'Skill One', description: '', category: 'test', content: '' },
          { scope: 'project', projectId: 'proj_1' }
        );
      });

      const state = useSkillsStore.getState();
      expect(state.installedSkills).toHaveLength(2);
      expect(state.installedScopedKeys.has('global:global:test/skill-one')).toBe(true);
      expect(state.installedScopedKeys.has('project:proj_1:test/skill-one')).toBe(true);
    });
  });

  describe('uninstallSkill', () => {
    it('removes only the targeted scope instance', async () => {
      const globalSkill = makeInstalledSkill({ scope: 'global' });
      const projectSkill = makeInstalledSkill({
        scope: 'project',
        projectId: 'proj_1',
        scopedKey: 'project:proj_1:test/skill-one',
      });

      useSkillsStore.setState({
        installedSkills: [globalSkill, projectSkill],
        installedScopedKeys: new Set([globalSkill.scopedKey, projectSkill.scopedKey]),
      });

      mockLevante.skills.uninstall.mockResolvedValue({ success: true, data: true });

      await act(async () => {
        await useSkillsStore.getState().uninstallSkill('test/skill-one', { scope: 'global' });
      });

      const state = useSkillsStore.getState();
      expect(state.installedSkills).toHaveLength(1);
      expect(state.installedSkills[0].scope).toBe('project');
      expect(state.installedScopedKeys.has('global:global:test/skill-one')).toBe(false);
      expect(state.installedScopedKeys.has('project:proj_1:test/skill-one')).toBe(true);
    });
  });

  describe('selectors', () => {
    beforeEach(() => {
      const globalSkill = makeInstalledSkill({ scope: 'global' });
      const projectSkill = makeInstalledSkill({
        scope: 'project',
        projectId: 'proj_1',
        scopedKey: 'project:proj_1:test/skill-one',
      });

      useSkillsStore.setState({
        installedSkills: [globalSkill, projectSkill],
        installedScopedKeys: new Set([globalSkill.scopedKey, projectSkill.scopedKey]),
      });
    });

    it('isInstalledAnywhere returns true if any instance exists', () => {
      expect(useSkillsStore.getState().isInstalledAnywhere('test/skill-one')).toBe(true);
      expect(useSkillsStore.getState().isInstalledAnywhere('other/skill')).toBe(false);
    });

    it('getInstalledBySkillId returns all instances of a skill', () => {
      const instances = useSkillsStore.getState().getInstalledBySkillId('test/skill-one');
      expect(instances).toHaveLength(2);
    });

    it('isInstalledInScope checks scope-specific installation', () => {
      expect(useSkillsStore.getState().isInstalledInScope('test/skill-one', 'global')).toBe(true);
      expect(useSkillsStore.getState().isInstalledInScope('test/skill-one', 'project', 'proj_1')).toBe(true);
      expect(useSkillsStore.getState().isInstalledInScope('test/skill-one', 'project', 'proj_2')).toBe(false);
    });

    it('legacy isInstalled checks only global scope', () => {
      expect(useSkillsStore.getState().isInstalled('test/skill-one')).toBe(true);
    });
  });
});
