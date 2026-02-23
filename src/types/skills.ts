export interface SkillDescriptor {
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

export type SkillScope = 'global' | 'project';

export interface InstalledSkill extends SkillDescriptor {
  installedAt: string; // ISO 8601
  filePath: string;
  companionDir?: string;
  fileKeys?: string[];

  // Scope info
  scope: SkillScope;
  // presente solo en scope project
  projectId?: string;
  projectName?: string;
  projectCwd?: string;

  // clave canonica por instancia para evitar colisiones por skill.id
  // format: "{scope}:{projectId|global}:{skillId}"
  scopedKey: string;
}

export interface InstallSkillOptions {
  scope?: SkillScope; // default 'global'
  projectId?: string; // requerido si scope === 'project'
}

export interface UninstallSkillOptions {
  scope: SkillScope;
  projectId?: string; // requerido si scope === 'project'
}

export interface SetUserInvocableOptions {
  scope: SkillScope;
  projectId?: string; // requerido si scope === 'project'
}

export type ListInstalledMode = 'global' | 'project-merged' | 'project-and-global' | 'all-scopes';

export interface ListInstalledSkillsOptions {
  mode?: ListInstalledMode; // default 'global'
  projectId?: string; // requerido en mode 'project-merged'
}

/**
 * Respuesta del endpoint GET /api/skills/:category/:name/bundle
 * Incluye todos los archivos compañeros de la skill (rules/, scripts/, etc.)
 */
export interface SkillBundleResponse extends SkillDescriptor {
  /**
   * Clave: ruta relativa desde la raíz de la skill (e.g. "rules/animations.md", "scripts/setup.sh")
   * Valor: contenido íntegro del archivo
   * Objeto vacío si la skill no tiene archivos compañeros.
   */
  files: Record<string, string>;
}

export type IPCResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };
