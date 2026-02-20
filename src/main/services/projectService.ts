import { InValue } from '@libsql/client';
import { databaseService } from './databaseService';
import { getLogger } from './logging';
import {
  Project,
  CreateProjectInput,
  UpdateProjectInput,
  DatabaseResult,
  ChatSession,
} from '../../types/database';

class ProjectService {
  private logger = getLogger();

  private generateId(): string {
    return `proj_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private rowToProject(row: unknown): Project {
    const r = row as Record<number, unknown>;
    return {
      id: r[0] as string,
      name: r[1] as string,
      cwd: r[2] as string | null,
      description: r[3] as string | null,
      created_at: r[4] as number,
      updated_at: r[5] as number,
    };
  }

  async createProject(input: CreateProjectInput): Promise<DatabaseResult<Project>> {
    const id = this.generateId();
    const now = Date.now();
    const project: Project = {
      id,
      name: input.name,
      cwd: input.cwd ?? null,
      description: input.description ?? null,
      created_at: now,
      updated_at: now,
    };
    try {
      await databaseService.execute(
        `INSERT INTO projects (id, name, cwd, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [id, input.name, project.cwd, project.description, now, now] as InValue[]
      );
      this.logger.database.info('Project created', { projectId: id, name: input.name });
      return { data: project, success: true };
    } catch (error) {
      this.logger.database.error('Failed to create project', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        data: {} as Project,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async getProject(id: string): Promise<DatabaseResult<Project | null>> {
    try {
      const result = await databaseService.execute(
        'SELECT * FROM projects WHERE id = ?',
        [id as InValue]
      );
      const row = result.rows[0];
      if (!row) return { data: null, success: true };
      return { data: this.rowToProject(row), success: true };
    } catch (error) {
      this.logger.database.error('Failed to get project', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        data: null,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async listProjects(): Promise<DatabaseResult<Project[]>> {
    try {
      const result = await databaseService.execute(
        'SELECT * FROM projects ORDER BY updated_at DESC',
        []
      );
      const projects = result.rows.map((row) => this.rowToProject(row));
      return { data: projects, success: true };
    } catch (error) {
      this.logger.database.error('Failed to list projects', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        data: [],
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async updateProject(input: UpdateProjectInput): Promise<DatabaseResult<Project>> {
    const { id, ...updates } = input;
    const fields: string[] = [];
    const params: InValue[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      params.push(updates.name as InValue);
    }
    if (updates.cwd !== undefined) {
      fields.push('cwd = ?');
      params.push((updates.cwd ?? null) as InValue);
    }
    if (updates.description !== undefined) {
      fields.push('description = ?');
      params.push((updates.description ?? null) as InValue);
    }

    if (fields.length === 0) {
      return this.getProject(id) as Promise<DatabaseResult<Project>>;
    }

    fields.push('updated_at = ?');
    params.push(Date.now() as InValue);
    params.push(id as InValue);

    try {
      await databaseService.execute(
        `UPDATE projects SET ${fields.join(', ')} WHERE id = ?`,
        params
      );
      this.logger.database.info('Project updated', { projectId: id });
      return this.getProject(id) as Promise<DatabaseResult<Project>>;
    } catch (error) {
      this.logger.database.error('Failed to update project', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        data: {} as Project,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async deleteProject(id: string): Promise<DatabaseResult<boolean>> {
    try {
      await databaseService.execute('DELETE FROM projects WHERE id = ?', [id as InValue]);
      this.logger.database.info('Project deleted', { projectId: id });
      return { data: true, success: true };
    } catch (error) {
      this.logger.database.error('Failed to delete project', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        data: false,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async getProjectSessions(projectId: string): Promise<DatabaseResult<ChatSession[]>> {
    try {
      const result = await databaseService.execute(
        `SELECT id, title, model, session_type, folder_id, created_at, updated_at, project_id
         FROM chat_sessions WHERE project_id = ? ORDER BY updated_at DESC`,
        [projectId as InValue]
      );
      const sessions = result.rows.map((row) => {
        const r = row as Record<number, unknown>;
        const sessionType = r[3] as string;
        return {
          id: r[0] as string,
          title: r[1] as string,
          model: r[2] as string,
          session_type: (sessionType === 'chat' || sessionType === 'inference') ? sessionType : 'chat' as any,
          folder_id: r[4] as string | null,
          created_at: r[5] as number,
          updated_at: r[6] as number,
          project_id: r[7] as string | null,
        };
      });
      return { data: sessions, success: true };
    } catch (error) {
      this.logger.database.error('Failed to get project sessions', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        data: [],
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

export const projectService = new ProjectService();
