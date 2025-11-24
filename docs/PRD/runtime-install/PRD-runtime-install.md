# PRD: Automatic Runtime Installation & Management

**Version:** 2.1
**Status:** Draft - Non-Technical First
**Created:** 2025-01-23
**Last Updated:** 2025-01-23
**Owner:** Levante Team

---

## 1. Executive Summary

### Problem Statement
Currently, Levante requires users to manually install runtime dependencies (Node.js, Python, uv, uvx, npx) before using MCP servers. This creates friction in the onboarding experience and leads to support issues when runtimes are missing or incompatible.

**Current Pain Points:**
- Users encounter "npx not found" or "uvx not found" errors
- Manual installation instructions are platform-specific and complex
- No guidance on which runtime version to install
- System diagnostics detect issues but don't resolve them

### Proposed Solution
Implement an **Automatic Runtime Manager** that:
1. Downloads and installs runtimes (Node.js, Python, uv) automatically
2. Manages shared runtimes in `~/levante/runtimes/` to avoid duplicate installations
3. Identifies runtime requirements from `mcp.json` configuration
4. Provides intelligent fallback: System runtime → Levante runtime → Installation prompt

### Success Metrics
- Reduce time-to-first-MCP-server from 15 minutes to < 2 minutes
- Decrease "runtime not found" support tickets by 90%
- Achieve 95%+ download success rate
- Achieve 98%+ installation success rate

### Target User Personas

#### Primary Persona (80%): Non-Technical User "Sarah"
**Background:**
- Has never used terminal/command line
- Doesn't know what Node.js or Python are
- Wants MCP servers to "just work" without configuration
- Gets frustrated by technical jargon and decisions

**Goals:**
- Add MCP servers with minimal clicks
- Avoid seeing technical error messages
- Trust the app to handle complexity automatically

**Pain Points:**
- Confused by installation prompts asking about "Node.js"
- Overwhelmed by version numbers and technical requirements
- Abandons setup when encountering terminal commands

**Design Implications:**
- Zero technical terminology in default UI
- Automatic installation without prompts
- Simple, reassuring progress indicators
- Error messages in plain language

#### Secondary Persona (20%): Technical User "Alex"
**Background:**
- Comfortable with terminal and package managers
- Has Node.js and Python already installed on system
- Wants control over which runtime versions to use
- Prefers to use system runtimes when possible

**Goals:**
- Fine-tune runtime configuration
- Override automatic behavior when needed
- View technical details and logs
- Understand what the system is doing

**Pain Points:**
- Frustrated when app installs duplicate runtimes
- Needs visibility into which runtime is being used
- Wants manual control options

**Design Implications:**
- Advanced settings section with full control
- Option to prefer system over Levante runtimes
- Detailed technical information on demand
- Manual override capabilities

---

## 2. Background & Context

### Current State

**Existing Detection System** (`src/main/services/mcp/diagnostics.ts`):
- ✅ Detects presence of node, npm, npx, python3, pip3, uvx
- ✅ Validates PATH configuration
- ✅ Provides recommendations when runtimes missing
- ❌ Does NOT install missing runtimes
- ❌ Does NOT manage runtime versions

**MCP Configuration** (`~/levante/mcp.json`):
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem"]
    },
    "time": {
      "command": "uvx",
      "args": ["mcp-server-time"]
    }
  }
}
```

**Runtime Requirements by Command Type:**
- `npx` → Requires: Node.js + npm
- `uvx` / `uv` → Requires: Python 3 + uv
- `python` / `python3` → Requires: Python 3

### Gap Analysis

| Capability | Current State | Required State |
|-----------|---------------|----------------|
| Runtime Detection | ✅ Implemented | ✅ Keep existing |
| Automatic Download | ❌ Not implemented | ✅ Required |
| Automatic Installation | ❌ Not implemented | ✅ Required |
| Version Management | ❌ Not implemented | ✅ Required |
| Shared Runtimes | ❌ Not implemented | ✅ Required |
| System Fallback | ⚠️ Partial | ✅ Enhanced |
| User Prompts | ❌ Not implemented | ✅ Required |

---

## 3. Requirements

### 3.1 Functional Requirements

#### FR1: Runtime Identification
- **FR1.1**: Parse `command` field from `mcp.json` to identify required runtime
- **FR1.2**: Support runtime types: `node`, `python`, `uv`
- **FR1.3**: Detect minimum version requirements (if specified)
- **FR1.4**: Store runtime requirements in server configuration

#### FR2: Runtime Resolution Strategy
- **FR2.1**: Check for compatible system runtime first (via existing diagnostics)
- **FR2.2**: If system runtime missing/incompatible, check Levante-managed runtime
- **FR2.3**: If no runtime available, prompt user for installation
- **FR2.4**: Allow user to override runtime source (system vs Levante) in settings

#### FR3: Automatic Download
- **FR3.1**: Download Node.js from official nodejs.org distribution
- **FR3.2**: Download Python from python-build-standalone project
- **FR3.3**: Download uv from official GitHub releases
- **FR3.4**: Support all platforms: macOS (arm64, x64), Windows (x64), Linux (x64, arm64)
- **FR3.5**: Display download progress (MB downloaded, percentage, ETA)
- **FR3.6**: Verify checksums (SHA256) against official sources
- **FR3.7**: Retry failed downloads (max 3 attempts)

#### FR4: Automatic Installation
- **FR4.1**: Extract downloaded archives to `~/levante/runtimes/{runtime}/{version}/`
- **FR4.2**: Create symlink `~/levante/runtimes/{runtime}/current` → latest version
- **FR4.3**: Verify installation by running `--version` command
- **FR4.4**: Register installation in `ui-preferences.json`
- **FR4.5**: Handle installation failures gracefully with rollback

#### FR5: Runtime Management
- **FR5.1**: Track which MCP servers use which runtimes
- **FR5.2**: Support multiple runtime versions simultaneously (future)
- **FR5.3**: Provide cleanup function to remove unused runtimes
- **FR5.4**: Display runtime usage statistics in UI
- **FR5.5**: Allow manual runtime removal via settings

#### FR6: Configuration Integration
- **FR6.1**: Extend `ui-preferences.json` with runtime configuration
- **FR6.2**: Store runtime metadata: version, path, installation date
- **FR6.3**: Add optional `runtime` field to MCP server configs in `mcp.json`
- **FR6.4**: Persist user preferences: prefer system vs Levante runtimes

#### FR7: User Experience (Non-Technical First)

**Default Behavior (Simple Mode):**
- **FR7.1**: Install runtimes AUTOMATICALLY without prompting (silent install)
- **FR7.2**: Show passive notification "Setting up server..." (no technical terms)
- **FR7.3**: Never mention "Node.js", "Python", "runtime" to non-technical users
- **FR7.4**: Use simple language: "Getting things ready..." instead of "Installing Node.js 22.11.0"
- **FR7.5**: Progress shown as simple percentage or spinner without technical details
- **FR7.6**: Errors shown in plain language with "Show technical details" expandable
- **FR7.7**: Non-blocking UI - background installation with toast notifications

**Advanced Mode (Opt-in via Settings):**
- **FR7.8**: Setting: "Show advanced installation options" (default: OFF)
- **FR7.9**: When enabled, show detailed dialogs with runtime names/versions
- **FR7.10**: When enabled, prompt before installation (user confirmation required)
- **FR7.11**: When enabled, allow manual runtime source selection (system vs Levante)
- **FR7.12**: When enabled, show technical error details immediately
- **FR7.13**: When enabled, display download speed, MB transferred, ETA
- **FR7.14**: Runtime status badges in MCP server list (only in advanced mode)

#### FR8: Progressive Disclosure
- **FR8.1**: Hide all technical terminology by default in UI
- **FR8.2**: Use colors/icons over text for status indicators (✅ ⚠️ ❌)
- **FR8.3**: "Advanced" sections in settings collapsed by default
- **FR8.4**: Expandable "Show technical details" in error messages
- **FR8.5**: First-time setup wizard optimized for non-technical users (3 clicks maximum)
- **FR8.6**: Technical mode toggle easily accessible in settings for power users
- **FR8.7**: Documentation split into "Quick Start" (simple) and "Advanced Guide" (technical)
- **FR8.8**: Context-sensitive help that adapts to user's mode (simple vs advanced)

### 3.2 Non-Functional Requirements

#### NFR1: Performance
- **NFR1.1**: Download time: < 2 minutes for Node.js (70MB)
- **NFR1.2**: Installation time: < 10 seconds for extraction
- **NFR1.3**: Runtime resolution: < 100ms per server start
- **NFR1.4**: Disk space: ≤ 400MB for full runtime set (Node + Python + uv)

#### NFR2: Security
- **NFR2.1**: Download from official sources only (HTTPS)
- **NFR2.2**: Verify SHA256 checksums before installation
- **NFR2.3**: Store runtimes in user directory (no admin privileges required)
- **NFR2.4**: Validate runtime binaries before first execution
- **NFR2.5**: Log all runtime installations for audit trail

#### NFR3: Reliability
- **NFR3.1**: Retry downloads on failure (max 3 attempts)
- **NFR3.2**: Rollback partial installations on error
- **NFR3.3**: Handle network interruptions gracefully
- **NFR3.4**: Detect and recover from corrupted runtimes

#### NFR4: Compatibility
- **NFR4.1**: Support macOS 11+ (arm64, x64)
- **NFR4.2**: Support Windows 10+ (x64)
- **NFR4.3**: Support Linux (Ubuntu 20.04+, Debian 11+)
- **NFR4.4**: Maintain backward compatibility with existing MCP configs

#### NFR5: Maintainability
- **NFR5.1**: Modular architecture for easy runtime type additions
- **NFR5.2**: Centralized runtime version configuration
- **NFR5.3**: Comprehensive logging via existing `logger.mcp.*` system
- **NFR5.4**: Unit tests for all runtime operations

---

## 4. Technical Architecture

### 4.1 Directory Structure

```
~/levante/
├── runtimes/
│   ├── node/
│   │   ├── v22.11.0/
│   │   │   ├── bin/
│   │   │   │   ├── node
│   │   │   │   ├── npm
│   │   │   │   └── npx
│   │   │   └── lib/
│   │   └── current -> v22.11.0
│   └── python/
│       ├── 3.13.0/
│       │   ├── bin/
│       │   │   ├── python3
│       │   │   ├── pip3
│       │   │   ├── uv          # Installed via pip
│       │   │   └── uvx         # Installed via pip
│       │   └── lib/
│       └── current -> 3.13.0
├── mcp.json
├── ui-preferences.json
└── runtimes-cache.json (new)
```

### 4.2 New Services

#### RuntimeManager (`src/main/services/runtime/RuntimeManager.ts`)
**Responsibilities:**
- Install and manage runtimes
- Track runtime versions and paths
- Handle cleanup of unused runtimes

**Key Methods:**
```typescript
interface RuntimeManager {
  ensureRuntime(config: RuntimeConfig): Promise<string>
  installRuntime(type: RuntimeType, version: string): Promise<string>
  findSystemRuntime(type: RuntimeType): Promise<string | null>
  listInstalledRuntimes(): RuntimeInfo[]
  removeRuntime(type: RuntimeType, version: string): Promise<void>
  cleanupUnusedRuntimes(): Promise<void>
}
```

#### RuntimeDownloader (`src/main/services/runtime/RuntimeDownloader.ts`)
**Responsibilities:**
- Download runtime archives from official sources
- Track download progress
- Verify checksums

**Key Methods:**
```typescript
interface RuntimeDownloader {
  download(url: string, destination: string, onProgress: ProgressCallback): Promise<void>
  verifyChecksum(file: string, expectedHash: string): Promise<boolean>
  getDownloadUrl(type: RuntimeType, version: string, platform: Platform): string
}
```

#### RuntimeInstaller (`src/main/services/runtime/RuntimeInstaller.ts`)
**Responsibilities:**
- Extract and install runtimes
- Create symlinks
- Verify installations

**Key Methods:**
```typescript
interface RuntimeInstaller {
  install(archivePath: string, targetDir: string): Promise<void>
  verify(runtimePath: string, type: RuntimeType): Promise<boolean>
  createSymlink(target: string, link: string): Promise<void>
}
```

#### RuntimeResolver (`src/main/services/runtime/RuntimeResolver.ts`)
**Responsibilities:**
- Resolve runtime paths for MCP servers
- Implement fallback strategy (system → Levante → prompt)
- Cache resolution results

**Key Methods:**
```typescript
interface RuntimeResolver {
  resolve(serverConfig: MCPServerConfig): Promise<ResolvedRuntime>
  identifyRequirement(command: string): RuntimeRequirement
  preferSystemRuntime(prefer: boolean): void
}
```

### 4.3 Modified Services

#### commandResolver.ts
**Changes:**
- Add integration with `RuntimeResolver`
- Use Levante runtimes if system runtime unavailable
- Update PATH to include Levante runtime directories

#### transports.ts
**Changes:**
- Use resolved runtime paths from `RuntimeResolver`
- Pass enhanced environment with runtime PATH

#### diagnostics.ts
**Changes:**
- Check both system AND Levante runtimes
- Return installation recommendations with Levante option

#### mcpConfigManager.ts
**Changes:**
- Add `runtime` field to server configurations
- Persist runtime source preference (system vs Levante)

### 4.4 Configuration Schema

#### ui-preferences.json Extension
```json
{
  "global": {
    "developerMode": false
  },
  "runtime": {
    "autoInstall": true,
    "preferSystemRuntimes": false,
    "installedRuntimes": {
      "node": {
        "version": "22.11.0",
        "path": "~/levante/runtimes/node/current",
        "installedAt": "2025-01-15T10:30:00Z",
        "usedBy": ["filesystem", "sequential-thinking"]
      },
      "python": {
        "version": "3.13.0",
        "path": "~/levante/runtimes/python/current",
        "installedAt": "2025-01-15T10:35:00Z",
        "uvVersion": "0.5.11",
        "usedBy": ["time"]
      }
    }
  }
}
```

**Configuration Field Explanations:**

**Global Settings:**
- `global.developerMode`: `false` (default) = Simple Mode for non-technical users
  - When `false`: Hide all technical details, automatic everything, friendly language
  - When `true`: Show technical details, enable advanced controls, allow system runtime preference
  - **Affects entire app**: Runtime UI, MCP diagnostics, chat metadata, logs access, error messages

**Runtime Settings:**
- `autoInstall`: `true` = install without asking (always enabled)
- `preferSystemRuntimes`: `false` (default) = Use Levante runtimes first
  - Only relevant when `developerMode: true`
  - When `true` in developer mode: Check system runtime before Levante
  - When `false`: Always use Levante runtime (guaranteed compatibility)

**Runtime Priority Logic:**
- **Simple Mode** (`developerMode: false`): Always Levante → System (fallback)
- **Developer Mode** (`developerMode: true`):
  - If `preferSystemRuntimes: true`: System → Levante
  - If `preferSystemRuntimes: false`: Levante → System

#### mcp.json Extension (per server)
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem"],
      "runtime": {
        "type": "node",
        "source": "system",
        "resolvedPath": "/usr/local/bin/npx",
        "version": "22.10.0"
      }
    }
  }
}
```

### 4.5 IPC Handlers

New IPC channels in `src/main/ipc/runtimeHandlers.ts`:

```typescript
// Runtime management
ipcMain.handle('levante/runtime/install', async (_, type: RuntimeType, version: string) => {
  return runtimeManager.installRuntime(type, version);
});

ipcMain.handle('levante/runtime/list', async () => {
  return runtimeManager.listInstalledRuntimes();
});

ipcMain.handle('levante/runtime/remove', async (_, type: RuntimeType, version: string) => {
  return runtimeManager.removeRuntime(type, version);
});

ipcMain.handle('levante/runtime/status', async (_, type: RuntimeType) => {
  return runtimeManager.getRuntimeStatus(type);
});

// Download progress streaming
ipcMain.on('levante/runtime/download-progress', (event, progress: DownloadProgress) => {
  event.sender.send('levante/runtime/download-progress', progress);
});
```

### 4.6 Data Flow

#### Runtime Installation Flow
```
User adds MCP Server
    ↓
Parse server config (command: "npx")
    ↓
Identify runtime requirement (Node.js)
    ↓
RuntimeResolver.resolve()
    ↓
Check system runtime (via diagnostics)
    ↓ (not found)
Check Levante runtime
    ↓ (not found)
Prompt user: "Install Node.js?"
    ↓ (user confirms)
RuntimeDownloader.download()
    ↓ (stream progress to UI)
RuntimeInstaller.install()
    ↓
RuntimeManager.register()
    ↓
Update ui-preferences.json
    ↓
Return resolved path to MCP service
    ↓
Start MCP server with Levante runtime
```

#### Runtime Resolution Priority
```typescript
function resolveRuntime(command: string): string {
  const { developerMode, preferSystemRuntimes } = preferences.global;

  // Simple Mode: Always Levante first (guaranteed compatibility)
  if (!developerMode) {
    const levantePath = findLevanteRuntime(command);
    if (levantePath) {
      return levantePath; // Use Levante runtime
    }

    // System as fallback only
    const systemPath = findSystemRuntime(command);
    if (systemPath && isCompatible(systemPath)) {
      return systemPath;
    }

    // Auto-install if not found
    throw new RuntimeNotFoundError(command, { autoInstall: true });
  }

  // Developer Mode: Respect preferSystemRuntimes setting
  if (preferSystemRuntimes) {
    // 1. Try system runtime first
    const systemPath = findSystemRuntime(command);
    if (systemPath && isCompatible(systemPath)) {
      return systemPath;
    }

    // 2. Fallback to Levante
    const levantePath = findLevanteRuntime(command);
    if (levantePath) {
      return levantePath;
    }
  } else {
    // 1. Try Levante runtime first
    const levantePath = findLevanteRuntime(command);
    if (levantePath) {
      return levantePath;
    }

    // 2. Fallback to system
    const systemPath = findSystemRuntime(command);
    if (systemPath && isCompatible(systemPath)) {
      return systemPath;
    }
  }

  // 3. Prompt for installation in developer mode
  throw new RuntimeNotFoundError(command, { autoInstall: false });
}
```

---

## 5. User Experience

### 5.1 User Flows

#### Flow 1: Non-Technical User - First Server (Simple Mode - Default)
**Scenario:** Sarah has never used terminal, doesn't know what Node.js is

1. User opens Levante
2. User navigates to MCP settings
3. User clicks "Add Server" → selects "Filesystem"
4. System detects Node.js not installed
5. **No dialog appears** - installation starts automatically in background
6. **Toast notification (non-blocking):**
   ```
   🔄 Setting up Filesystem server...
   This may take a minute
   ```
7. *[30-120 seconds background download & install]*
8. **Success toast:**
   ```
   ✅ Filesystem server is ready!
   ```
9. Server appears in list with green checkmark ✅
10. User can immediately start using the server

**Result:** Total clicks: 2 | Time: ~1-2 min | No technical decisions required

#### Flow 1b: Technical User - First Server (Advanced Mode - Opt-in)
**Scenario:** Alex wants control over installation

1. User has previously enabled "Advanced mode" in Settings
2. User clicks "Add Server" → selects "Filesystem"
3. System detects Node.js not installed
4. **Dialog appears:**
   ```
   Node.js 22.11.0 Required

   [Install Automatically] [Use System Runtime] [Configure] [Cancel]

   Details:
   • Download: 70 MB
   • Disk space: ~200 MB
   • Time: 1-2 minutes
   ```
5. User clicks "Install Automatically"
6. **Progress dialog (blocking):**
   ```
   Installing Node.js 22.11.0

   Downloading... [=====>    ] 35 MB / 70 MB (50%)
   Speed: 8 MB/s | Time remaining: 4s

   [Cancel]
   ```
7. **Success dialog:**
   ```
   ✅ Node.js 22.11.0 installed

   Location: ~/levante/runtimes/node/current
   Used by: filesystem

   [View Details] [OK]
   ```
8. Server starts automatically

**Result:** Full visibility and control over installation process

#### Flow 2: User with System Runtime (Both Modes)
**Scenario:** User already has Node.js installed on their system

1. User adds MCP server
2. System detects compatible system runtime (Node.js 22.10.0)
3. Server starts immediately (no prompts, no installation)

**Simple Mode UI:** Server appears with ✅ instantly
**Advanced Mode UI:** Toast shows "Using system runtime: Node.js v22.10.0"

#### Flow 3: Incompatible Runtime - Simple Mode
**Scenario:** Sarah has old Node.js (16.x), needs 18+

1. User adds MCP server
2. System detects Node.js 16.14.0 (incompatible)
3. **No prompt** - system automatically installs Levante runtime
4. **Toast notification:**
   ```
   🔄 Setting up Filesystem server...
   ```
5. Server starts with Levante Node.js 22.11.0
6. System runtime unchanged (user never knows about version conflict)

#### Flow 3b: Incompatible Runtime - Advanced Mode
**Scenario:** Alex has old Node.js, wants to know about it

1. User adds MCP server
2. System detects Node.js 16.14.0 (incompatible)
3. **Dialog appears:**
   ```
   ⚠️ Node.js Update Required

   Installed: Node.js 16.14.0
   Required: Node.js 18+

   [Install Levante Runtime] [Try System Anyway] [Cancel]

   Note: System runtime may not work correctly.
   Levante can install a compatible version without affecting
   your system installation.
   ```
4. User clicks "Install Levante Runtime"
5. Server uses Levante runtime (system runtime untouched)

#### Flow 4: Installation Failure - Simple Mode
**Scenario:** No internet connection

1. User adds MCP server
2. Download fails (no internet)
3. **Simple error toast:**
   ```
   ⚠️ Couldn't set up server

   Please check your internet connection and try again.

   [Try Again] [Get Help]

   > Show technical details
   ```
4. If user clicks "Show technical details":
   ```
   Error: Connection timeout
   URL: https://nodejs.org/dist/v22.11.0/...
   Attempts: 3 of 3 failed

   Manual installation:
   1. Download Node.js from nodejs.org
   2. Install version 20+
   3. Restart Levante

   [Copy Download Link] [View Logs]
   ```

#### Flow 4b: Installation Failure - Advanced Mode
**Scenario:** Network issue, technical user

1. User adds MCP server
2. Download fails
3. **Detailed error dialog:**
   ```
   ❌ Download Failed: Node.js 22.11.0

   Error: Connection timeout after 30s
   URL: https://nodejs.org/dist/v22.11.0/node-v22.11.0-darwin-arm64.tar.gz
   Attempts: 3 of 3

   Possible solutions:
   • Check your internet connection
   • Check firewall settings
   • Manual installation: https://nodejs.org/

   [Retry] [Copy URL] [Manual Instructions] [Close]

   View logs: ~/levante/logs/runtime.log
   ```

### 5.2 First-Time Setup Wizard

**Goal:** Help non-technical users get started without configuration

#### Screen 1: Welcome
```
┌──────────────────────────────────────┐
│                                      │
│   Welcome to Levante! 🎉             │
│                                      │
│   Chat with AI and extend it with   │
│   powerful tools called servers.     │
│                                      │
│          [Get Started]               │
│                                      │
└──────────────────────────────────────┘
```

#### Screen 2: Setup Mode Selection
```
┌────────────────────────────────────────┐
│   Choose Your Experience               │
│                                        │
│   ○ Automatic (Recommended) ✨         │
│     Perfect for getting started        │
│     We'll handle setup for you         │
│                                        │
│   ○ Advanced                           │
│     Full control over configuration    │
│     For technical users                │
│                                        │
│   [Continue]                           │
│                                        │
│   You can change this later in         │
│   Settings > Advanced                  │
└────────────────────────────────────────┘
```

#### Screen 3: Add First Server (Optional)
```
┌──────────────────────────────────────┐
│   Add Your First Server 🚀           │
│                                      │
│   Popular servers to get started:    │
│                                      │
│   [ ] 📁 Filesystem                  │
│       Access and manage files        │
│                                      │
│   [ ] ⏰ Time                         │
│       Time zones and scheduling      │
│                                      │
│   [ ] 🧠 Sequential Thinking         │
│       Enhanced reasoning             │
│                                      │
│   [Add Selected]  [Skip for now]    │
└──────────────────────────────────────┘
```

#### Screen 4: Setup Complete
```
┌──────────────────────────────────────┐
│   All Set! 🎊                        │
│                                      │
│   Levante is ready to use.           │
│                                      │
│   ✅ Automatic setup enabled         │
│   ✅ Servers will install seamlessly │
│                                      │
│          [Start Using Levante]       │
│                                      │
│   💡 Tip: Add more servers anytime   │
│      from Settings > MCP Servers     │
└──────────────────────────────────────┘
```

**Key Design Decisions:**
- Maximum 3-4 clicks to complete
- No technical jargon in default path
- Option to skip wizard entirely
- "Advanced" option clearly marked for technical users
- Wizard shown only on first launch (never again unless reset)

### 5.3 UI Components

#### Toast Notification (Simple Mode - Default)
**Location:** Top-right corner, non-blocking
**Triggers:** Any runtime operation in simple mode
**Variants:**

**Setup in Progress:**
```
┌────────────────────────────────┐
│ 🔄 Setting up server...        │
│ This may take a minute         │
└────────────────────────────────┘
```

**Success:**
```
┌────────────────────────────────┐
│ ✅ Server is ready!            │
└────────────────────────────────┘
```

**Error (Expandable):**
```
┌────────────────────────────────┐
│ ⚠️ Couldn't set up server      │
│                                │
│ Check your internet connection │
│                                │
│ [Try Again]  [Get Help]        │
│                                │
│ > Show technical details       │
└────────────────────────────────┘
```

#### Runtime Installation Dialog (Advanced Mode Only)
**Location:** Modal overlay (blocking)
**Triggers:** When runtime required and advanced mode enabled
**Components:**
```
┌─────────────────────────────────────────┐
│   Node.js 22.11.0 Required              │
│                                         │
│   The "Filesystem" server requires      │
│   Node.js to run.                       │
│                                         │
│   Download: 70 MB                       │
│   Disk space: ~200 MB                   │
│   Time: 1-2 minutes                     │
│                                         │
│   [Install Automatically]               │
│   [Use System Runtime]                  │
│   [Manual Instructions]                 │
│   [Cancel]                              │
└─────────────────────────────────────────┘
```

#### Download Progress (Advanced Mode Only)
**Location:** Modal overlay
**Components:**
```
┌─────────────────────────────────────────┐
│   Installing Node.js 22.11.0            │
│                                         │
│   [=========>           ] 45%           │
│                                         │
│   Downloaded: 32 MB / 70 MB             │
│   Speed: 8 MB/s                         │
│   Time remaining: 4s                    │
│                                         │
│   [Cancel]                              │
└─────────────────────────────────────────┘
```

#### Runtime Manager Panel
**Location:** Settings → Advanced → Runtime Management
**Visibility:** Hidden unless "Advanced mode" enabled
**Components:**

**Mode Selection:**
```
Installation Mode:
○ Automatic (Recommended)  ← Default
  Install everything automatically

○ Ask Before Installing
  Show confirmation dialogs

○ Manual Only
  Never install automatically
```

**Advanced Options:**
```
☑ Show technical details
☑ Prefer system runtimes when available
☐ Check for runtime updates
```

**Installed Runtimes (Expandable):**
```
▶ Installed Runtimes (2)

  📦 Node.js 22.11.0
     Source: Levante
     Used by: 2 servers
     Size: 185 MB
     [Remove]

  🐍 Python 3.13.0 (with uv 0.5.11)
     Source: Levante
     Used by: 1 server
     Size: 267 MB
     [Remove]

[Cleanup Unused Runtimes]
```

#### MCP Server List Enhancement
**Location:** MCP Settings Page

**Simple Mode:**
- Server cards show only status icon
- ✅ = Ready
- 🔄 = Setting up
- ⚠️ = Issue (rare, with "Get Help" link)

**Advanced Mode:**
- Runtime badge visible on each server card
- Badge shows: "Node.js 22.11" or "Python 3.13" or "System"
- Badge color: Green (system), Blue (Levante), Grey (none)
- Click badge → runtime details popup

### 5.4 Design Principles

**Core Philosophy:** "Zero Configuration for Non-Technical, Full Control for Technical"

#### 1. Zero Learning Curve
- **No technical jargon** in default UI
- Use **icons and colors** over text where possible
- **"Just works"** by default - no decisions required
- Actions described in terms of user goals, not implementation
  - ✅ "Setting up server" ❌ "Installing Node.js runtime"
  - ✅ "Get Help" ❌ "View logs at ~/levante/logs"

#### 2. Progressive Disclosure
- **Hide complexity** until needed
- **"Advanced" sections** collapsed by default in settings
- **Expandable details** on demand ("Show technical details")
- Information hierarchy: Simple → Intermediate → Advanced
- Never show advanced options unless user explicitly enables advanced mode

#### 3. Sensible Defaults
- **Automatic everything** - install without prompting
- **No decisions required** for 80% use case
- **Optimize for non-technical** users by default
- System over Levante runtimes (respect existing setup)
- Settings pre-configured for best user experience

#### 4. Escape Hatches
- **Technical mode always accessible** via Settings → Advanced
- **Manual override always available** for power users
- **Full control** when needed, hidden when not
- **Detailed logs and diagnostics** available on demand
- Never block users who want to configure manually

#### 5. Friendly Language
- Use **plain English**, avoid technical terms
- **Positive reinforcement** ("Server is ready!" vs "Installation succeeded")
- **Helpful errors** in user terms ("Check your internet" vs "HTTP 403 Forbidden")
- **Action-oriented** ("Try Again" vs "Retry download (attempt 2/3)")
- **Reassuring progress** ("This may take a minute" vs "Downloading 35/70 MB")

#### 6. Non-Blocking UI
- **Background operations** whenever possible
- **Toast notifications** instead of modal dialogs (simple mode)
- **Never block workflow** for non-critical tasks
- **Contextual help** available without disrupting flow
- Cancel operations easily if needed

#### 7. Fail Gracefully
- **Simple error messages** with actionable solutions
- **"Get Help" links** to documentation
- **Automatic retry** for transient failures
- **Clear next steps** when manual intervention needed
- **No dead ends** - always provide a path forward

---

## 6. Implementation Plan

### Phase 1: Core Infrastructure (Week 1)
**Goal:** Set up foundation for runtime management

**Tasks:**
- [ ] Create `RuntimeManager` service skeleton
- [ ] Implement runtime identification from MCP command
- [ ] Design configuration schema extensions
- [ ] Add `runtimes/` directory structure
- [ ] Implement basic logging integration

**Deliverables:**
- `src/main/services/runtime/RuntimeManager.ts`
- `src/main/types/runtime.ts`
- Configuration migration for `ui-preferences.json`

### Phase 2: Download & Install (Week 2)
**Goal:** Implement core download and installation logic

**Tasks:**
- [ ] Implement `RuntimeDownloader` with progress tracking
- [ ] Implement `RuntimeInstaller` with extraction
- [ ] Add checksum verification
- [ ] Handle platform-specific download URLs
- [ ] Implement retry logic for failed downloads
- [ ] Add installation rollback on failure

**Deliverables:**
- `src/main/services/runtime/RuntimeDownloader.ts`
- `src/main/services/runtime/RuntimeInstaller.ts`
- Unit tests for download/install logic

### Phase 3: Integration (Week 3)
**Goal:** Integrate runtime management with existing MCP system

**Tasks:**
- [ ] Implement `RuntimeResolver` with fallback strategy
- [ ] Update `commandResolver.ts` to use RuntimeResolver
- [ ] Modify `transports.ts` to use resolved runtime paths
- [ ] Enhance `diagnostics.ts` to check Levante runtimes
- [ ] Update `mcpConfigManager.ts` to store runtime info
- [ ] Add IPC handlers for runtime operations

**Deliverables:**
- `src/main/services/runtime/RuntimeResolver.ts`
- `src/main/ipc/runtimeHandlers.ts`
- Updated MCP service integration

### Phase 4: UI & UX (Week 4)
**Goal:** Build user-facing components and flows (Simple Mode First!)

**Priority 1 - Must Have (Simple Mode):**
- [ ] Toast notification component for passive install feedback
- [ ] Simple error dialogs with expandable details
- [ ] First-time setup wizard (4 screens)
- [ ] Mode toggle in settings (Automatic vs Advanced)
- [ ] Status icons for MCP server list (✅ 🔄 ⚠️)

**Priority 2 - Should Have (Advanced Mode):**
- [ ] Runtime Installation Dialog (advanced mode only)
- [ ] Download Progress Dialog (advanced mode only)
- [ ] Runtime Manager settings panel (advanced mode only)
- [ ] Runtime badges for MCP server cards
- [ ] Technical error details view

**Priority 3 - Nice to Have:**
- [ ] Manual installation instructions modal
- [ ] Runtime usage statistics visualization
- [ ] Advanced diagnostics view

**Deliverables:**
- `src/renderer/components/runtime/ToastNotification.tsx` (Priority 1)
- `src/renderer/components/runtime/SimpleErrorDialog.tsx` (Priority 1)
- `src/renderer/components/runtime/SetupWizard.tsx` (Priority 1)
- `src/renderer/components/runtime/RuntimeInstallDialog.tsx` (Priority 2)
- `src/renderer/components/runtime/RuntimeManagerPanel.tsx` (Priority 2)
- `src/renderer/components/runtime/DownloadProgress.tsx` (Priority 2)
- Updated MCP settings page

**Success Criteria:**
- Non-technical user can add first server in < 5 clicks
- Zero technical terminology in default UI
- Advanced mode accessible but hidden by default

### Phase 5: Testing & Polish (Week 5)
**Goal:** Ensure reliability across platforms

**Tasks:**
- [ ] Unit tests for all runtime services (80%+ coverage)
- [ ] Integration tests for runtime resolution flow
- [ ] E2E tests for installation UI flow
- [ ] Cross-platform testing (macOS, Windows, Linux)
- [ ] Performance testing (download speeds, installation time)
- [ ] Security audit (checksum verification, path validation)
- [ ] Documentation and user guides

**Deliverables:**
- Comprehensive test suite
- Performance benchmarks
- Security audit report
- User documentation in `docs/guides/runtime-management.md`

### Phase 6: Optional Enhancements (Future)
**Goal:** Advanced features for power users

**Tasks:**
- [ ] Support multiple Node.js versions simultaneously
- [ ] Automatic runtime version updates
- [ ] Runtime version compatibility matrix
- [ ] Custom runtime source URLs
- [ ] Portable runtime packages for offline installation

---

## 7. Edge Cases & Error Handling

### 7.1 Edge Cases

| Scenario | Behavior |
|----------|----------|
| User cancels download mid-way | Clean up partial download, show cancellation message |
| Disk space insufficient | Check available space before download, show error if insufficient |
| Corrupted download | Verify checksum, retry download up to 3 times |
| Network timeout | Retry with exponential backoff, show manual instructions after 3 failures |
| System runtime changes version | Re-detect on app restart, update config |
| Levante runtime binary deleted manually | Detect missing binary on server start, offer re-installation |
| Two servers need different Node.js versions | Use single version (latest), plan multi-version support for future |
| User has both system and Levante runtime | Use based on `preferSystemRuntimes` setting |
| MCP server uses custom runtime path | Respect custom path if specified, skip automatic resolution |
| Permission issues writing to ~/levante/ | Show error with instructions to check directory permissions |

### 7.2 Error Messages (Two-Level Approach)

#### Network Errors

**Simple Mode (Default):**
```
⚠️ Couldn't set up server

Please check your internet connection and try again.

[Try Again]  [Get Help]

> Show technical details
```

**If user clicks "Show technical details":**
```
Error: Connection timeout
URL: https://nodejs.org/dist/v22.11.0/...
Attempts: 3 of 3 failed

Manual installation:
1. Download Node.js from nodejs.org
2. Install version 20+
3. Restart Levante

[Copy Download Link] [View Logs]
```

**Advanced Mode:**
```
❌ Download Failed: Node.js 22.11.0

Error: Connection timeout after 30s
URL: https://nodejs.org/dist/v22.11.0/node-v22.11.0-darwin-arm64.tar.gz
Attempts: 3 of 3

Possible solutions:
• Check your internet connection
• Check firewall settings
• Manual installation: https://nodejs.org/

[Retry] [Copy URL] [Manual Instructions] [Close]

View logs: ~/levante/logs/runtime.log
```

#### Disk Space Errors

**Simple Mode:**
```
⚠️ Not enough space

You need about 200 MB of free space.
Currently available: 50 MB

Free up some space and try again.

[Get Help]  [Close]

> Show technical details
```

**Advanced Mode:**
```
❌ Insufficient Disk Space

Required: 200 MB for Node.js 22.11.0
Available: 50 MB on /Users/username

Free up disk space and retry installation.

[Open Storage Settings] [Close]
```

#### Checksum Verification Errors

**Simple Mode:**
```
🔄 Retrying setup...

(Automatic retry - no user action needed)
```

**Advanced Mode:**
```
⚠️ Checksum Verification Failed

Downloaded file is corrupted (checksum mismatch).

Expected: a1b2c3d4...
Received: e5f6g7h8...

Retrying automatically...
Attempt 2 of 3

[Cancel]
```

#### Permission Errors

**Simple Mode:**
```
⚠️ Setup problem

Can't create required files.

[Get Help]  [Close]

> Show technical details
```

**If expanded:**
```
Error: Permission denied
Location: ~/levante/runtimes/

Try these steps:
1. Close Levante
2. Check folder permissions
3. Restart Levante

Need more help? Visit: [Help Center]
```

**Advanced Mode:**
```
❌ Permission Denied

Cannot write to ~/levante/runtimes/

Directory permissions may be incorrect.

Fix permissions:
chmod 755 ~/levante

[Copy Command] [Open Terminal] [Close]
```

---

## 8. Success Metrics & KPIs

### 8.1 Primary Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Time to first MCP server | < 2 min | Time from "Add Server" to "Server Running" |
| Download success rate | > 95% | Successful downloads / Total attempts |
| Installation success rate | > 98% | Successful installs / Total attempts |
| Runtime not found errors | < 5% | Errors / Total server starts |
| User satisfaction (NPS) | > 50 | Post-installation survey |

### 8.2 Secondary Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Average download time | < 90s | For Node.js on 10 Mbps connection |
| Disk space usage | < 400 MB | Total for Node + Python + uv |
| System runtime adoption | > 60% | Users preferring system over Levante |
| Cleanup usage | > 30% | Users using cleanup feature monthly |
| Support ticket reduction | 90% | Decrease in runtime-related tickets |

### 8.3 Monitoring & Analytics

**Events to Track:**
- `runtime.install.started` - { type, version, source }
- `runtime.install.completed` - { type, version, duration }
- `runtime.install.failed` - { type, version, error }
- `runtime.download.progress` - { type, percentComplete }
- `runtime.resolution` - { command, source: system|levante|none }
- `runtime.cleanup.executed` - { removedRuntimes }

**Logs to Monitor:**
- Download failures with error codes
- Checksum verification failures
- Installation rollbacks
- Runtime resolution fallbacks

### 8.4 Metrics Segmentation by Mode

Track separately for Simple vs Advanced mode to understand each persona's experience:

| Metric | Simple Mode Target | Advanced Mode Target | Measurement |
|--------|-------------------|---------------------|-------------|
| Time to first server | < 90s | < 2 min | From "Add Server" to "Running" |
| Installation success | > 99% | > 95% | Successful installs / Total |
| User confusion rate | < 2% | < 10% | Support tickets / Active users |
| Settings usage | < 5% | > 60% | Users who access Runtime Settings |
| Support tickets | < 3% | < 8% | Runtime-related tickets / Total |
| Mode switches | Track | Track | Users switching simple → advanced |
| Error expansion rate | - | - | Users clicking "Show technical details" |

**Key Performance Indicators:**

**For Simple Mode (Primary Persona):**
- **Zero-click installation rate:** > 95% (no user interaction required)
- **Completion without errors:** > 98%
- **Average clicks to first server:** < 3
- **Time in setup wizard:** < 60s

**For Advanced Mode (Secondary Persona):**
- **System runtime usage:** > 70% (prefer existing installations)
- **Manual override usage:** 20-40% (control when needed)
- **Technical details viewed:** > 50% (transparency)
- **Settings customization:** > 60% (configuration)

**Warning Signals:**
- If > 20% of simple mode users switch to advanced mode → **Improve automatic mode**
- If < 5% of advanced mode users use custom settings → **Consider removing feature**
- If simple mode success rate < 95% → **Critical issue, investigate immediately**
- If > 10% simple mode users click "Get Help" → **Improve error messages**

---

## 9. Security Considerations

### 9.1 Threat Model

| Threat | Mitigation |
|--------|-----------|
| Man-in-the-middle download | Use HTTPS only, verify checksums |
| Malicious runtime binary | Download from official sources only, verify signatures |
| Path traversal during extraction | Validate all paths before extraction |
| Arbitrary code execution | Validate runtime binaries before first use |
| Privilege escalation | Install in user directory only (no admin) |
| Supply chain attack | Pin runtime versions, verify checksums |

### 9.2 Security Checklist

- [x] All downloads use HTTPS
- [x] Verify SHA256 checksums against official sources
- [ ] Verify GPG signatures (Node.js provides SHASUMS256.txt.sig)
- [x] Validate extraction paths to prevent path traversal
- [x] Store runtimes in user directory (no admin privileges)
- [x] Log all installations for audit trail
- [x] Validate runtime binary integrity before execution
- [x] Use existing `packageValidator.ts` patterns for security

### 9.3 Official Download Sources

**Node.js:**
- URL: `https://nodejs.org/dist/vX.Y.Z/`
- Checksum: `SHASUMS256.txt`
- Signature: `SHASUMS256.txt.sig` (GPG)

**Python (python-build-standalone):**
- URL: `https://github.com/indygreg/python-build-standalone/releases/`
- Checksum: Provided in release assets (SHA256)

**UV:**
- URL: `https://github.com/astral-sh/uv/releases/`
- Checksum: Provided in release page

---

## 10. Testing Strategy

### 10.1 Unit Tests

**RuntimeManager:**
- ✅ Identify runtime from command type
- ✅ Resolve runtime (system vs Levante)
- ✅ Install runtime successfully
- ✅ Handle installation failure
- ✅ Cleanup unused runtimes
- ✅ Track runtime usage by servers

**RuntimeDownloader:**
- ✅ Download file with progress tracking
- ✅ Verify checksum success
- ✅ Verify checksum failure
- ✅ Retry on network failure
- ✅ Cancel download mid-way

**RuntimeInstaller:**
- ✅ Extract tar.gz archive (Unix)
- ✅ Extract zip archive (Windows)
- ✅ Create symlink
- ✅ Verify installation
- ✅ Rollback on failure

**RuntimeResolver:**
- ✅ Resolve to system runtime when available
- ✅ Resolve to Levante runtime when system unavailable
- ✅ Return null when no runtime found
- ✅ Respect user preference (system vs Levante)
- ✅ Handle version compatibility

### 10.2 Integration Tests

**MCP Integration:**
- ✅ Start MCP server with system runtime
- ✅ Start MCP server with Levante runtime
- ✅ Fallback from system to Levante
- ✅ Update runtime path when server config changes
- ✅ Handle multiple servers sharing runtime

**Configuration Integration:**
- ✅ Persist runtime info to ui-preferences.json
- ✅ Persist runtime metadata to mcp.json
- ✅ Migrate existing configs correctly
- ✅ Handle missing config files

### 10.3 E2E Tests (Playwright)

**Installation Flow:**
- ✅ User adds MCP server without runtime → Installation dialog appears
- ✅ User installs runtime → Download progress shown
- ✅ Installation completes → Server starts automatically
- ✅ User cancels installation → Server not added

**Runtime Management:**
- ✅ User views installed runtimes in settings
- ✅ User removes unused Levante runtime
- ✅ User toggles "Prefer system runtimes" setting
- ✅ User runs cleanup → Unused runtimes removed

**Error Handling:**
- ✅ Network failure during download → Retry shown
- ✅ Disk space insufficient → Error shown
- ✅ Checksum mismatch → Re-download initiated
- ✅ Manual installation instructions accessible

### 10.4 Platform Testing Matrix

| Platform | Architecture | Node.js | Python | UV |
|----------|-------------|---------|--------|-----|
| macOS 14 | arm64 | ✅ | ✅ | ✅ |
| macOS 14 | x64 | ✅ | ✅ | ✅ |
| Windows 11 | x64 | ✅ | ✅ | ✅ |
| Ubuntu 22.04 | x64 | ✅ | ✅ | ✅ |
| Ubuntu 22.04 | arm64 | ✅ | ✅ | ✅ |

### 10.5 User Testing

#### Non-Technical User Testing (Primary Persona)
**Goal:** Validate that simple mode "just works" with zero technical knowledge

**Participants:**
- Recruit 10-15 users with **NO technical background**
- Screening criteria:
  - Never used terminal/command line
  - Don't know what Node.js or Python are
  - Have not installed development tools before
  - Use computers for basic tasks only (browsing, email, documents)

**Test Scenario 1: First Server Installation**
**Task:** "Add the Filesystem server to Levante"
**Success Criteria:**
- ✅ Completes task without asking questions (> 90% completion rate)
- ✅ Takes < 2 minutes (average time)
- ✅ Rates experience 4+ out of 5 (satisfaction)
- ✅ Doesn't need "Get Help" button (< 10% usage)
- ✅ Can explain what happened in non-technical terms

**Test Scenario 2: Error Recovery**
**Task:** Simulate network failure during install
**Success Criteria:**
- ✅ Understands error message immediately
- ✅ Knows how to retry without guidance
- ✅ Doesn't feel frustrated or confused
- ✅ Doesn't mention seeing technical terms

**Observation Metrics:**
- Time to complete task
- Number of clicks/actions
- Moments of confusion (pause > 10s)
- Help requests
- Technical terms mentioned
- Overall satisfaction rating

**Failure Indicators:**
- User asks "What is Node.js?"
- User sees error and gives up
- User tries to use terminal
- User takes > 5 minutes
- User expresses frustration

#### Technical User Testing (Secondary Persona)
**Goal:** Validate that advanced mode provides sufficient control

**Participants:**
- Recruit 5-8 developers/power users
- Screening criteria:
  - Comfortable with terminal
  - Already has Node.js/Python installed
  - Uses package managers (npm, brew, pip)
  - Wants control over development environment

**Test Scenario 1: Use System Runtime**
**Task:** "Add a server using your existing system Node.js installation"
**Success Criteria:**
- ✅ Can find advanced settings easily (< 30s)
- ✅ Can override automatic behavior
- ✅ Can verify which runtime is being used
- ✅ Rates control level 4+ out of 5

**Test Scenario 2: Runtime Management**
**Task:** "View all installed runtimes and remove unused ones"
**Success Criteria:**
- ✅ Can access runtime manager
- ✅ Can identify which servers use which runtimes
- ✅ Can remove Levante runtimes
- ✅ Appreciates level of visibility

**Test Scenario 3: Troubleshooting**
**Task:** Simulate checksum failure
**Success Criteria:**
- ✅ Can view technical error details
- ✅ Can access log files
- ✅ Has enough information to debug
- ✅ Doesn't feel "locked out" of details

**Observation Metrics:**
- Time to find advanced settings
- Usage of technical features
- Satisfaction with level of control
- Feature discovery rate
- Confidence in system behavior

#### A/B Testing

**Test 1: Setup Wizard vs No Wizard**
- A: First-time wizard (current design)
- B: Skip wizard, default automatic mode
- **Metric:** Time to first server, user satisfaction

**Test 2: Error Message Verbosity**
- A: Simple errors with expandable details (current design)
- B: Always show full technical details
- **Metric:** User comprehension, task completion

**Test 3: Toast vs Modal Progress**
- A: Toast notification (simple mode, current design)
- B: Modal progress dialog
- **Metric:** Perceived speed, satisfaction, abandonment rate

---

## 11. Documentation Requirements

### 11.1 User Documentation (Two-Track Approach)

**Documentation Principle:** Default docs assume zero technical knowledge, with clear path to advanced docs.

#### Track 1: Quick Start Guide (Non-Technical Users)
**File:** `docs/guides/getting-started.md`
**Target:** Sarah (non-technical)
**Length:** 5-minute read with screenshots
**Tone:** Friendly, reassuring, no jargon

**Content:**
- ✅ "Welcome to Levante" (what it does in plain language)
- ✅ "Adding Your First Server" (step-by-step with screenshots)
- ✅ "What to Expect" (server will set up automatically)
- ✅ "If Something Goes Wrong" (simple troubleshooting)
- ✅ Common questions in plain language:
  - "Why is it taking a minute to set up?" (downloading needed files)
  - "What if I see an error?" (check internet, try again)
  - "Can I use Levante without internet?" (need it for setup)

**Rules:**
- NO terminal commands
- NO technical terms (Node.js, Python, runtime, dependencies, etc.)
- Use "server" instead of "MCP server"
- Use "setting up" instead of "installing dependencies"
- Every screenshot shows the EXACT UI the user will see

#### Track 2: Advanced Guide (Technical Users)
**File:** `docs/guides/runtime-management-advanced.md`
**Target:** Alex (technical)
**Length:** 15-minute read with code examples
**Tone:** Technical, detailed, comprehensive

**Content:**
- ✅ Runtime architecture and directory structure
- ✅ How automatic installation works (technical details)
- ✅ System vs Levante runtime resolution priority
- ✅ Manual runtime installation instructions (all platforms)
- ✅ Runtime configuration options
- ✅ Cleanup and maintenance
- ✅ Troubleshooting with log analysis
- ✅ Custom runtime paths
- ✅ Multiple runtime versions (future)

#### Track 3: Troubleshooting (Bifurcated)
**File:** `docs/guides/troubleshooting.md`
**Structure:** Start simple, progressive disclosure

```markdown
# Troubleshooting

## Server won't set up

**Try these steps:**
1. Check your internet connection
2. Click "Try Again"
3. Restart Levante

Still not working? → [Advanced Troubleshooting]

---

## Advanced Troubleshooting (Expandable)

### Connection errors
- Error code: ...
- Log location: ...
- Manual installation: ...
```

**Updated Guides:**
- `docs/developer/local-mcp-development.md` - Add Levante runtime workflows
- `README.md` - Update requirements (now optional!)
- `docs/FAQ.md` - Add non-technical FAQ section

**Cross-Linking Strategy:**
- Quick Start → Links to Advanced Guide (clearly marked "For Technical Users")
- Advanced Guide → Links back to Quick Start
- Error messages → Link to relevant doc section (appropriate for mode)
- "Get Help" button → Quick Start troubleshooting (simple) or Advanced troubleshooting (advanced mode)

### 11.2 Developer Documentation

**New Documentation:**
- `docs/architecture/runtime-management.md` - Technical architecture
- `docs/api/runtime-services.md` - API reference for RuntimeManager

**Updated Documentation:**
- `CLAUDE.md` - Add runtime management system overview
- `docs/architecture/overview.md` - Update with runtime layer

**Content:**
- Architecture diagrams
- Service responsibilities
- Configuration schema
- IPC handler reference
- Adding new runtime types
- Testing runtime code

### 11.3 Code Documentation

**Required:**
- JSDoc comments for all public methods
- Type definitions with descriptions
- Inline comments for complex logic
- Examples in method documentation

**Example:**
```typescript
/**
 * Ensures a runtime is available for the given configuration.
 *
 * Resolution order:
 * 1. Check system runtime (if preferSystemRuntimes is true)
 * 2. Check Levante-managed runtime
 * 3. Prompt user for installation
 *
 * @param config Runtime configuration specifying type and version
 * @returns Absolute path to runtime executable
 * @throws RuntimeNotFoundError if no compatible runtime found and user declines installation
 *
 * @example
 * const nodePath = await runtimeManager.ensureRuntime({
 *   type: 'node',
 *   version: '22.11.0',
 *   source: 'shared'
 * });
 * // Returns: ~/levante/runtimes/node/current/bin/node
 */
async ensureRuntime(config: RuntimeConfig): Promise<string>
```

---

## 12. Open Questions & Decisions

### 12.1 Resolved Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Support multiple Node.js versions? | No (Phase 1), Yes (Phase 2) | Simplifies initial implementation, add later if needed |
| Auto-update runtimes? | No | Stability > latest features, let user control updates |
| System vs Levante priority? | System first (default) | Respect existing user setup, allow override |
| Disk space threshold? | Warn if < 500 MB free | Conservative threshold for safety |
| Offline installation? | Manual instructions only | Auto-installation requires network |

### 12.2 Open Questions

| Question | Options | Recommendation |
|----------|---------|----------------|
| ARM architecture auto-detect? | Yes / Manual selection | Yes (use process.arch) |
| Runtime version pinning? | Pin to LTS / Latest stable | Pin to LTS for stability |
| Download mirror support? | Yes / No | No initially, add if needed |
| Runtime update notifications? | Yes / No | Yes, but manual updates only |
| Support custom download sources? | Yes / No | No (security risk) |

### 12.3 Future Considerations

**Features to Consider:**
- Portable runtime packages for offline installation
- Runtime version compatibility matrix UI
- Automatic runtime version recommendations based on MCP server
- Shared runtime pool across multiple Levante installations (multi-user systems)
- Runtime performance monitoring and optimization suggestions

**Technical Debt to Address:**
- Consider using native addons for faster archive extraction
- Optimize checksum verification for large files
- Implement streaming extraction (extract while downloading)
- Add telemetry for download speeds across regions

---

## 13. Rollout Plan

### 13.1 Alpha Release (Internal Testing)
**Target:** Week 6
**Scope:**
- Feature complete on macOS only
- Limited runtime support (Node.js only)
- Internal team testing
- Bug fixes and polish

**Exit Criteria:**
- 90% unit test coverage
- 0 critical bugs
- Successful installation on 5 internal machines

### 13.2 Beta Release (Early Adopters)
**Target:** Week 8
**Scope:**
- All platforms supported (macOS, Windows, Linux)
- All runtimes supported (Node.js, Python, uv)
- Public beta opt-in
- Feedback collection

**Exit Criteria:**
- 95% download success rate
- 98% installation success rate
- < 10 P1 bugs reported
- Positive feedback from 80%+ beta users

### 13.3 General Availability
**Target:** Week 10
**Scope:**
- Enable for all users by default
- Full documentation published
- Support team trained

**Exit Criteria:**
- All P0/P1 bugs fixed
- 95%+ installation success rate (30-day window)
- < 5% support ticket rate for runtime issues
- Performance targets met

### 13.4 Rollback Plan

**If critical issues found:**
1. Disable automatic installation via feature flag
2. Revert to diagnostic-only mode (show recommendations)
3. Fix issues in hotfix release
4. Re-enable feature incrementally (10% → 50% → 100%)

**Rollback Triggers:**
- Installation success rate < 90%
- > 20% users encountering errors
- Security vulnerability discovered
- Data loss or corruption

---

## 14. Dependencies & Risks

### 14.1 Dependencies

| Dependency | Type | Mitigation |
|------------|------|-----------|
| nodejs.org uptime | External | Cache last-known-good URLs, provide manual instructions |
| GitHub (python-build-standalone) | External | Same as above |
| GitHub (uv releases) | External | Same as above |
| Electron safeStorage | Internal | Already used for API keys, proven stable |
| Existing MCP system | Internal | Well-tested, minimal changes needed |

### 14.2 Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|-----------|
| Download source unavailable | Medium | High | Retry with exponential backoff, fallback to manual instructions |
| Incompatible runtime version | Low | Medium | Version compatibility checks, clear error messages |
| Disk space exhaustion | Low | Medium | Check available space before download |
| Corrupted downloads | Low | Medium | Checksum verification, automatic re-download |
| User confusion about system vs Levante | Medium | Low | Clear UI indicators, help documentation |
| Performance issues on slow networks | High | Low | Show accurate time estimates, allow cancellation |
| Breaking changes in download sources | Low | High | Pin URLs to specific versions, monitor sources |

---

## 15. Appendix

### 15.1 Related Documents
- [MCP System Diagnostics PRD](../mcp-system-diagnostics.md)
- [Local MCP Development Guide](../../developer/local-mcp-development.md)
- [Configuration Storage Guide](../../guides/configuration-storage.md)
- [Raw Technical Analysis](./raw-runtime-install.md)

### 15.2 References
- **Node.js Distributions:** https://nodejs.org/dist/
- **Python Build Standalone:** https://github.com/indygreg/python-build-standalone
- **UV Releases:** https://github.com/astral-sh/uv/releases
- **MCP Specification:** https://modelcontextprotocol.io/
- **Electron Security:** https://www.electronjs.org/docs/latest/tutorial/security

### 15.3 Glossary

| Term | Definition |
|------|------------|
| **Runtime** | Execution environment (Node.js, Python) required to run MCP servers |
| **System Runtime** | Runtime installed by user on their system (e.g., via Homebrew) |
| **Levante Runtime** | Runtime downloaded and managed by Levante in `~/levante/runtimes/` |
| **Shared Runtime** | Single runtime used by multiple MCP servers |
| **Runtime Resolution** | Process of determining which runtime to use for an MCP server |
| **Fallback Strategy** | Priority order for runtime selection (system → Levante → install) |
| **uvx** | Package executor for Python (equivalent to npx for Node.js) |
| **npx** | Package executor for Node.js |

### 15.4 Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2025-01-23 | 1.0 | Initial PRD creation |
| 2025-01-23 | 2.0 | Major revision: Non-technical user first approach |
|            |     | - Added Target User Personas (Sarah & Alex) |
|            |     | - Rewritten FR7: User Experience (Simple/Advanced modes) |
|            |     | - Added FR8: Progressive Disclosure requirements |
|            |     | - Updated configuration defaults (autoInstall: true) |
|            |     | - Rewritten User Experience flows for both personas |
|            |     | - Added First-Time Setup Wizard (5.2) |
|            |     | - Updated UI Components for dual-mode design |
|            |     | - Added Design Principles section (5.4) |
|            |     | - Updated Error Handling with two-level approach |
|            |     | - Added Metrics Segmentation by Mode (8.4) |
|            |     | - Added User Testing section (10.5) |
|            |     | - Updated Documentation for two-track approach |
|            |     | - Adjusted Phase 4 priorities (Simple Mode first) |
| 2025-01-23 | 2.1 | Architecture refinements and version updates |
|            |     | - Added global `developerMode` configuration (app-wide setting) |
|            |     | - Updated runtime versions: Node.js 22.11.0, Python 3.13.0 |
|            |     | - Integrated UV with Python via pip (removed separate UV directory) |
|            |     | - Changed runtime priority: Levante-first in simple mode |
|            |     | - Updated `preferSystemRuntimes` default to `false` |
|            |     | - Enhanced runtime resolution logic with mode-aware priority |
|            |     | - Updated directory structure (2 directories instead of 3) |
|            |     | - Added `uvVersion` tracking in Python runtime config |

---

**Approval Signatures:**

- [ ] Product Owner: _______________  Date: _____
- [ ] Engineering Lead: _______________  Date: _____
- [ ] Security Review: _______________  Date: _____
- [ ] UX Review: _______________  Date: _____
