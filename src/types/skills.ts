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
