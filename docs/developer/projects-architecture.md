# Projects Feature — Architecture Deep Dive

## Overview

The **Projects** feature in Levante allows users to group chat sessions under a named project, each with an optional working directory (`cwd`) and description. The project's CWD becomes the effective directory for Cowork Mode tools, skill scoping, and the sidebar file browser.

---

## 1. Database Layer

### Schema

**Table: `projects`**

| Column       | Type    | Notes                                       |
|-------------|---------|---------------------------------------------|
| `id`        | TEXT PK | Format: `proj_{timestamp}_{random7chars}`   |
| `name`      | TEXT    | NOT NULL                                    |
| `cwd`       | TEXT    | Nullable — filesystem path                  |
| `description` | TEXT  | Nullable                                    |
| `created_at` | INTEGER | Unix timestamp ms                          |
| `updated_at` | INTEGER | Unix timestamp ms                          |

**FK on `chat_sessions`**: `project_id TEXT REFERENCES projects(id) ON DELETE CASCADE`
Sessions without a project have `project_id IS NULL`.

### Migrations (runtime)

**File**: `src/main/services/databaseService.ts`

- **Version 6**: Creates `projects` table, adds `project_id` column + index on `chat_sessions`.
- **Version 9**: Idempotent repair migration — re-creates the same schema in case prior migrations (7/8) dropped it.

**SQL doc file** (not executed at runtime): `database/migrations/0006_add_projects.sql`

---

## 2. Type Definitions

**File**: `src/types/database.ts`

```typescript
export interface Project {
  id: string;
  name: string;
  cwd?: string | null;
  description?: string | null;
  created_at: number;
  updated_at: number;
}

export interface CreateProjectInput {
  name: string;
  cwd?: string;
  description?: string;
}

export interface UpdateProjectInput {
  id: string;
  name?: string;
  cwd?: string | null;
  description?: string | null;
}
```

`ChatSession` includes `project_id?: string | null`.
`CreateChatSessionInput`, `UpdateChatSessionInput`, and `GetChatSessionsQuery` also include `project_id`.

---

## 3. Main Process — ProjectService

**File**: `src/main/services/projectService.ts`

Singleton exported as `projectService`. Methods:

| Method | Description |
|--------|-------------|
| `generateId()` | Returns `proj_{Date.now()}_{random7}` |
| `rowToProject(row)` | Converts libsql Row to `Project` (columns: 0:id, 1:name, 2:cwd, 3:description, 4:created_at, 5:updated_at) |
| `createProject(input)` | INSERT with generated ID + current timestamp |
| `getProject(id)` | SELECT by primary key |
| `listProjects()` | SELECT all, ordered by `updated_at DESC` |
| `updateProject(input)` | Dynamic UPDATE — only provided fields, always sets `updated_at` |
| `deleteProject(id)` | DELETE — cascades to associated chat sessions via FK |
| `getProjectSessions(projectId)` | SELECT sessions WHERE `project_id = ?`, ordered by `updated_at DESC` |

All return `DatabaseResult<T>` (`{ data, success, error? }`).

---

## 4. Main Process — ChatService Integration

**File**: `src/main/services/chatService.ts`

- **`createSession`**: Accepts `project_id` from `CreateChatSessionInput`, stores as `project_id ?? null`.
- **`getSession`**: Reads `project_id` at column index 7.
- **`getSessions`**: Filtering logic:
  - `project_id === null` (explicit) → `WHERE project_id IS NULL` (general/unassigned sessions)
  - `project_id !== undefined` (specific ID) → `WHERE project_id = ?`
  - Otherwise → all sessions
- **`updateSession`**: Can update `project_id` via the generic field update loop.

---

## 5. IPC Handlers

**File**: `src/main/ipc/projectHandlers.ts`

Registered via `setupProjectHandlers()`, called from `src/main/lifecycle/initialization.ts` (line 152).

| IPC Channel | Operation |
|-------------|-----------|
| `levante/projects/create` | `projectService.createProject(input)` |
| `levante/projects/get` | `projectService.getProject(id)` |
| `levante/projects/list` | `projectService.listProjects()` |
| `levante/projects/update` | `projectService.updateProject(input)` |
| `levante/projects/delete` | `projectService.deleteProject(id)` |
| `levante/projects/sessions` | `projectService.getProjectSessions(projectId)` |

Each channel uses `ipcMain.removeHandler()` before `ipcMain.handle()` to avoid duplicate handler errors.

---

## 6. Preload / Bridge Layer

### Preload API

**File**: `src/preload/api/projects.ts`

```typescript
export const projectsApi = {
  create: (input) => ipcRenderer.invoke('levante/projects/create', input),
  get: (id) => ipcRenderer.invoke('levante/projects/get', id),
  list: () => ipcRenderer.invoke('levante/projects/list'),
  update: (input) => ipcRenderer.invoke('levante/projects/update', input),
  delete: (id) => ipcRenderer.invoke('levante/projects/delete', id),
  getSessions: (projectId) => ipcRenderer.invoke('levante/projects/sessions', projectId),
};
```

### Bridge Assembly

**File**: `src/preload/preload.ts`

Assembled into `window.levante.projects` with full TypeScript interface on `LevanteAPI`.

### ChatRequest Types

**File**: `src/preload/types/index.ts`

`ChatRequest` includes:
- `projectDescription?: string` — injected into AI system prompt
- `projectContext?: { projectId?: string }` — used for skills scoping

---

## 7. Renderer — Zustand Stores

### useProjectStore

**File**: `src/renderer/stores/projectStore.ts`

```typescript
interface ProjectStore {
  projects: Project[];
  loading: boolean;
  error: string | null;
  loadProjects: () => Promise<void>;
  createProject: (input: CreateProjectInput) => Promise<Project | null>;
  updateProject: (input: UpdateProjectInput) => Promise<boolean>;
  deleteProject: (id: string) => Promise<boolean>;
}
```

- `loadProjects()` — fetches via `window.levante.projects.list()`, sets array
- `createProject()` — creates via IPC, prepends to local array
- `updateProject()` — updates via IPC, replaces in-place by ID
- `deleteProject()` — deletes via IPC, filters out from array

### chatStore Integration

**File**: `src/renderer/stores/chatStore.ts`

`createSession(title, model, sessionType, projectId?)` passes `project_id: projectId ?? null` to the IPC create call.

---

## 8. UI Components

### 8.1 ProjectModal (Create/Edit Dialog)

**File**: `src/renderer/components/projects/ProjectModal.tsx`

Dialog with three fields:
- **Name** (required): text input, max 100 chars
- **CWD** (optional): text input + folder picker via `window.levante.cowork.selectWorkingDirectory()`
- **Description** (optional): textarea

Controlled by `projectModalOpen` / `editingProject` state in `App.tsx`.

### 8.2 ProjectPage (Detail View)

**File**: `src/renderer/pages/ProjectPage.tsx`

Props: `project`, `onSessionSelect`, `onNewSessionInProject`, `onDeleteSession`.

- Header with project name + `FolderOpen` icon
- Chat input area with model selector to create new sessions with an initial message
- Session list fetched via `window.levante.projects.getSessions(project.id)`, sorted by `updated_at DESC`
- Each session shows title, model, date, delete option

### 8.3 SidebarSections

**File**: `src/renderer/components/sidebar/SidebarSections.tsx`

Two modes:
1. **Inside a project** (`selectedProjectId` set): Shows back button ("Exit project") + "New Chat"
2. **Normal view**: Shows "New Chat" + collapsible "Projects" section with:
   - "+" button for create
   - Project list with `FolderOpen` icon, name, context menu (edit/delete)
   - Click selects project via `onProjectSelect`
   - Delete confirmation shows associated session count

### 8.4 ChatListContent

**File**: `src/renderer/components/chat/ChatListContent.tsx`

**Critical filtering** (lines 62-64):
```typescript
const baseSessions = isProjectScope
  ? sessions.filter((s) => s.project_id === selectedProjectId)
  : sessions.filter((s) => !s.project_id);
```

- Inside project → shows only that project's sessions, with header "History: {projectName}"
- No project → shows only unassigned sessions with temporal groupings (today/yesterday/etc.)

### 8.5 ChatList (Legacy Wrapper)

**File**: `src/renderer/components/chat/ChatList.tsx`

Wrapper around `ChatListContent` with search bar + "New Chat" button. Passes project props through.

### 8.6 MainLayout

**File**: `src/renderer/components/layout/MainLayout.tsx`

Accepts `selectedProjectName?` prop. When set, shows project name as muted label in the header bar.

### 8.7 ChatPromptInput / ToolsMenu

**Files**:
- `src/renderer/components/chat/ChatPromptInput.tsx` — accepts `projectId?`, passes to `ToolsMenu`
- `src/renderer/components/chat/ToolsMenu.tsx` — passes `projectId` to `SkillsPanel`, shows CWD source label (`'project'`)

---

## 9. App.tsx — The Orchestrator

**File**: `src/renderer/App.tsx`

### State

```typescript
const [selectedProject, setSelectedProject] = useState<Project | null>(null);
const [projectModalOpen, setProjectModalOpen] = useState(false);
const [editingProject, setEditingProject] = useState<Project | undefined>(undefined);
const [deleteConfirmProject, setDeleteConfirmProject] = useState<{id; name; count} | null>(null);
```

Uses `useProjectStore` for `projects`, `loadProjects`, `createProject`, `updateProject`, `deleteProject`.

### Lifecycle

- `loadProjects()` called on mount via `useEffect`

### Key Handlers

| Handler | Description |
|---------|-------------|
| `handleProjectSave` | Delegates to `updateProject` or `createProject` based on presence of `id` |
| `handleProjectSelect` | Sets `selectedProject`, navigates to `'project'` page |
| `handleNewSessionInProject` | Creates session with `projectId`, sets pending prompt, navigates to chat |
| `handleExitProject` | Clears `selectedProject`, navigates to chat page |
| `handleNewChat` | Inside project → `handleNewSessionInProject`; otherwise → regular new chat |
| `handleLoadSession` | Loads session; if it has `project_id`, restores `selectedProject` accordingly |

### Page Routing

```typescript
case 'project':
  return selectedProject ? <ProjectPage ... /> : <ChatPage />
```

### Sidebar Wiring

`getSidebarContent()` calls `ChatPage.getSidebarContent(...)` with all project callbacks:
- `projects`, `selectedProjectId`, `selectedProjectName`
- `onProjectSelect`, `onCreateProject`, `onEditProject`, `onDeleteProject`
- `onExitProject`

### Effective CWD

```typescript
const effectiveSidebarCwd = selectedProject?.cwd ?? coworkModeCwd ?? null;
```

Project CWD takes priority over global Cowork CWD for the sidebar file browser.

### Modals

- `ProjectModal` for create/edit
- `AlertDialog` for delete confirmation (shows project name + session count)

---

## 10. ChatPage.tsx — Project-Aware Chat

**File**: `src/renderer/pages/ChatPage.tsx`

### CWD Priority System (3-tier)

```typescript
const resolvedCoworkCwd = useMemo(() => {
  if (currentSessionCwdOverride) return { cwd: currentSessionCwdOverride, source: 'session' };
  if (currentProject?.cwd)        return { cwd: currentProject.cwd, source: 'project' };
  if (coworkModeCwd)              return { cwd: coworkModeCwd, source: 'global' };
  return { cwd: null, source: 'none' };
}, [currentSessionCwdOverride, currentProject?.cwd, coworkModeCwd]);
```

**Priority**: session override > project CWD > global Cowork CWD > none

### Current Project Derivation

```typescript
const currentProject = useMemo(() => {
  if (!currentSession?.project_id) return undefined;
  return projects.find((p) => p.id === currentSession.project_id);
}, [currentSession?.project_id, projects]);
```

### System Prompt

`projectDescription` derived from `currentProject?.description` is passed to the transport and ultimately injected via `buildSystemPrompt()`.

### Transport Configuration

`ElectronChatTransport` receives `projectDescription` and `projectId`:

```typescript
createElectronChatTransport({
  model, enableMCP, coworkMode,
  coworkModeCwd: effectiveCwd,
  projectDescription,
  projectId: currentSession?.project_id ?? null,
});
```

---

## 11. ElectronChatTransport

**File**: `src/renderer/transports/ElectronChatTransport.ts`

In `sendMessages()`, project data flows into the `ChatRequest`:

```typescript
const request: ChatRequest = {
  messages,
  model,
  enableMCP,
  ...(projectDescription && { projectDescription }),
  ...(projectId && { projectContext: { projectId } }),
  ...(coworkMode && coworkModeCwd && { codeMode: { enabled: true, cwd: coworkModeCwd } }),
};
```

---

## 12. AI Service — System Prompt & Skills

### System Prompt Injection

**File**: `src/main/services/ai/systemPromptBuilder.ts`

```typescript
if (projectDescription) {
  systemPrompt += `\n\nPROJECT CONTEXT:\n${projectDescription}`;
}
```

### Skills Scoping

**File**: `src/main/services/aiService.ts`

```typescript
const projectId = projectContext?.projectId;
installedSkills = await skillsService.listInstalledSkills(
  projectId ? { mode: 'project-merged', projectId } : { mode: 'global' }
);
```

**File**: `src/main/services/skillsService.ts`

In `'project-merged'` mode:
1. Fetches the project via `resolveProjectForScope(projectId)`
2. Validates the project has a `cwd`
3. Scans `{project.cwd}/.levante/skills/` for project-scoped skills
4. Merges project skills over global skills (project skills override by `skill.id`)

---

## 13. Context Budget Service

**File**: `src/main/services/contextBudgetService.ts`

Includes `projectDescription` and `projectContext` in token estimation calculations.

**Preload**: `src/preload/api/contextBudget.ts` passes these fields to IPC.

---

## 14. Complete File Map

| Layer | File | Role |
|-------|------|------|
| **DB migration (doc)** | `database/migrations/0006_add_projects.sql` | SQL documentation |
| **DB migration (runtime)** | `src/main/services/databaseService.ts` | Versions 6 & 9 — create/repair projects schema |
| **Types** | `src/types/database.ts` | Project interfaces, ChatSession.project_id |
| **Main service** | `src/main/services/projectService.ts` | CRUD + getProjectSessions |
| **Main service** | `src/main/services/chatService.ts` | Session CRUD with project_id filtering |
| **IPC handlers** | `src/main/ipc/projectHandlers.ts` | 6 `levante/projects/*` channels |
| **Initialization** | `src/main/lifecycle/initialization.ts` | Calls `setupProjectHandlers()` |
| **Preload API** | `src/preload/api/projects.ts` | Wraps IPC for renderer |
| **Preload bridge** | `src/preload/preload.ts` | Assembles into `window.levante.projects` |
| **Preload types** | `src/preload/types/index.ts` | ChatRequest.projectDescription/projectContext |
| **Zustand store** | `src/renderer/stores/projectStore.ts` | useProjectStore CRUD actions |
| **Zustand store** | `src/renderer/stores/chatStore.ts` | createSession with projectId param |
| **App orchestrator** | `src/renderer/App.tsx` | Project state, modals, routing, sidebar wiring |
| **Chat page** | `src/renderer/pages/ChatPage.tsx` | CWD resolution, description→prompt, transport config |
| **Project page** | `src/renderer/pages/ProjectPage.tsx` | Project detail view with session list |
| **Project modal** | `src/renderer/components/projects/ProjectModal.tsx` | Create/edit dialog with dir picker |
| **Sidebar** | `src/renderer/components/sidebar/SidebarSections.tsx` | Project list, exit button, file browser |
| **Chat list** | `src/renderer/components/chat/ChatListContent.tsx` | Filters sessions by project_id |
| **Chat list (legacy)** | `src/renderer/components/chat/ChatList.tsx` | Wrapper, passes project props |
| **Layout** | `src/renderer/components/layout/MainLayout.tsx` | Shows project name in header |
| **Prompt input** | `src/renderer/components/chat/ChatPromptInput.tsx` | Passes projectId to ToolsMenu |
| **Tools menu** | `src/renderer/components/chat/ToolsMenu.tsx` | Passes projectId to SkillsPanel |
| **Transport** | `src/renderer/transports/ElectronChatTransport.ts` | Sends project data in ChatRequest |
| **AI service** | `src/main/services/aiService.ts` | Uses projectContext for skills scoping |
| **System prompt** | `src/main/services/ai/systemPromptBuilder.ts` | Injects PROJECT CONTEXT section |
| **Skills service** | `src/main/services/skillsService.ts` | Scans project CWD for scoped skills |
| **Context budget** | `src/main/services/contextBudgetService.ts` | Includes project data in token estimation |
| **Context budget API** | `src/preload/api/contextBudget.ts` | Passes project fields to IPC |
| **Cowork API** | `src/preload/api/cowork.ts` | `selectWorkingDirectory()` used by ProjectModal |

---

## 15. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        RENDERER PROCESS                         │
│                                                                 │
│  useProjectStore ←→ App.tsx (orchestrator)                      │
│       ↕                  ↕          ↕          ↕                │
│  ProjectModal    ProjectPage   SidebarSections  ChatListContent │
│       ↕                                                         │
│  Directory Picker (cowork API)                                  │
│                                                                 │
│  ChatPage.tsx → resolvedCoworkCwd (session > project > global)  │
│       ↕                                                         │
│  ElectronChatTransport → ChatRequest {                          │
│    projectDescription, projectContext, codeMode.cwd             │
│  }                                                              │
└──────────────────────────┬──────────────────────────────────────┘
                           │ IPC (window.levante.projects.*)
                           │ IPC (levante/chat/stream)
┌──────────────────────────▼──────────────────────────────────────┐
│                         MAIN PROCESS                            │
│                                                                 │
│  projectHandlers.ts → projectService.ts → databaseService.ts   │
│                                                                 │
│  aiService.ts:                                                  │
│    ├─ systemPromptBuilder → injects projectDescription          │
│    └─ skillsService → scans {project.cwd}/.levante/skills/     │
│                                                                 │
│  chatService.ts → sessions filtered by project_id              │
│                                                                 │
│  contextBudgetService.ts → token estimation with project data   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 16. Key Behaviors Summary

1. **Project CWD** is a filesystem path set via native directory picker. It becomes the effective working directory for Cowork Mode tools (bash, file operations), the sidebar file browser, and project-scoped skill scanning.

2. **CWD priority**: session override > project CWD > global Cowork CWD > none.

3. **Session isolation**: Sessions belong to exactly one project or are "unassigned". The sidebar filters accordingly — inside a project you only see that project's sessions; outside you only see unassigned ones.

4. **Cascade delete**: Deleting a project cascades to all its sessions via the FK constraint.

5. **System prompt**: The project's `description` is injected as `PROJECT CONTEXT` in the AI system prompt.

6. **Skills scoping**: When inside a project with a CWD, skills are loaded from `{project.cwd}/.levante/skills/` and merged over global skills.

7. **Session restoration**: Loading a session that belongs to a project automatically restores the project context (`selectedProject`).
