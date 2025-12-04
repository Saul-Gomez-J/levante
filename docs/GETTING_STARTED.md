# Getting Started with Levante Development

This guide will help you set up your development environment and get Levante running locally.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Fork and Clone](#fork-and-clone)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the Application](#running-the-application)
- [Logs and Debugging](#logs-and-debugging)
- [Common Commands](#common-commands)
- [Next Steps](#next-steps)

## Prerequisites

Before you begin, ensure you have the following installed on your system:

### Required

- **Node.js** (LTS version, >= 18.x recommended)
  - Download from [nodejs.org](https://nodejs.org/)
  - Verify installation: `node --version`

- **pnpm** (Package manager)
  ```bash
  npm install -g pnpm
  # Verify installation
  pnpm --version
  ```

### Optional but Recommended

- **uv** (For MCP server development)
  ```bash
  curl -LsSf https://astral.sh/uv/install.sh | sh
  # Verify installation
  uv --version
  ```

- **Git** (Version control)
  - Download from [git-scm.com](https://git-scm.com/)
  - Verify installation: `git --version`

### Platform-Specific Requirements

#### macOS
- Xcode Command Line Tools:
  ```bash
  xcode-select --install
  ```

#### Windows
- Windows Build Tools (automatically installed with Node.js installer)
- Recommended: Windows Terminal for better CLI experience

#### Linux
- Build essentials:
  ```bash
  sudo apt-get install build-essential  # Debian/Ubuntu
  sudo yum groupinstall "Development Tools"  # RHEL/CentOS
  ```

---

## Fork and Clone

Levante follows a **fork-based contribution workflow**. You'll need to fork the repository to your GitHub account before starting development.

### 1. Fork the Repository

1. Go to [github.com/levante-hub/levante](https://github.com/levante-hub/levante)
2. Click the **Fork** button in the top-right corner
3. Select your GitHub account as the destination

### 2. Clone Your Fork

```bash
# Clone your fork (replace YOUR_USERNAME with your GitHub username)
git clone https://github.com/YOUR_USERNAME/levante.git
cd levante

# Add upstream remote to keep your fork synced
git remote add upstream https://github.com/levante-hub/levante.git

# Verify remotes
git remote -v
```

You should see:
```
origin    https://github.com/YOUR_USERNAME/levante.git (fetch)
origin    https://github.com/YOUR_USERNAME/levante.git (push)
upstream  https://github.com/levante-hub/levante.git (fetch)
upstream  https://github.com/levante-hub/levante.git (push)
```

### 3. Checkout the Development Branch

All development happens on the `develop` branch:

```bash
git checkout develop
git pull upstream develop
```

---

## Installation

Install all project dependencies:

```bash
pnpm install
```

This will:
- Install Node.js dependencies
- Set up Electron
- Configure development tools (TypeScript, ESLint, etc.)

**Note:** Installation may take a few minutes depending on your internet connection.

---

## Configuration

### 1. Environment Variables

Levante uses environment variables for configuration. Create a `.env.local` file in the project root:

```bash
# Copy the example file
cp .env .env.local
```

### 2. Edit `.env.local`

Open `.env.local` and configure your settings:

```bash
# AI Provider API Keys
# You only need to configure the providers you want to use

# OpenAI (required for GPT models)
OPENAI_API_KEY=sk-your-openai-api-key-here

# Anthropic (required for Claude models)
ANTHROPIC_API_KEY=sk-ant-your-anthropic-api-key-here

# Google (required for Gemini models)
GOOGLE_GENERATIVE_AI_API_KEY=your-google-ai-api-key-here

# Development settings
NODE_ENV=development

# Logging configuration
DEBUG_ENABLED=true          # Master switch for all debug logging
DEBUG_AI_SDK=true           # AI service operations and streaming
DEBUG_MCP=true              # MCP server management and tools
DEBUG_DATABASE=false        # Database operations and migrations
DEBUG_IPC=false             # Inter-process communication
DEBUG_PREFERENCES=false     # Settings and configuration
DEBUG_CORE=true             # Application lifecycle and errors
LOG_LEVEL=debug             # Minimum log level (debug|info|warn|error)
```

**API Keys (Optional for Development):**
- You can start without API keys and configure them later in the app's Settings
- For testing AI features, you'll need at least one provider's API key
- Get API keys from:
  - OpenRouter: [openrouter.ai](https://openrouter.ai)
  - OpenAI: [platform.openai.com](https://platform.openai.com)
  - Anthropic: [console.anthropic.com](https://console.anthropic.com)
  - Google: [ai.google.dev](https://ai.google.dev)

**Important:** Never commit `.env.local` to version control (it's in `.gitignore`).

---

## Running the Application

### Development Mode

Start the application in development mode with hot-reload:

```bash
pnpm dev
```

This will:
- Start the Vite dev server for the renderer process
- Compile the main process with hot-reload
- Launch Electron with DevTools enabled
- Watch for file changes

**Note:** The first launch may take a minute as it compiles TypeScript and initializes the database.

### What to Expect

On first launch, you'll see:
1. **Welcome Wizard** - Quick setup guide
2. **Model Configuration** - Add your AI providers
3. **MCP Store** - Browse available tools (optional)

---

## Logs and Debugging

### Log Locations

Levante logs are stored in the following locations:

| Platform | Log Path |
|----------|----------|
| macOS    | `~/Library/Logs/levante/` |
| Windows  | `%USERDATA%\AppData\Roaming\levante\logs\` |
| Linux    | `~/.config/levante/logs/` |

### Log Files

- `main.log` - Main process logs (Electron backend)
- `renderer.log` - Renderer process logs (React frontend)

### Viewing Logs in Real-Time

**Option 1: Terminal output**
When running `pnpm dev`, logs are printed to the terminal in real-time.

**Option 2: Tail log files**
```bash
# macOS/Linux
tail -f ~/Library/Logs/levante/main.log

# Windows (PowerShell)
Get-Content -Path "$env:APPDATA\levante\logs\main.log" -Wait
```

### Controlling Log Verbosity

Edit `.env.local` to control what gets logged:

```bash
# Disable all debug logs
DEBUG_ENABLED=false

# Enable only specific categories
DEBUG_ENABLED=true
DEBUG_AI_SDK=true
DEBUG_MCP=false
DEBUG_DATABASE=false

# Change log level (debug, info, warn, error)
LOG_LEVEL=info
```

See [docs/LOGGING.md](./LOGGING.md) for complete logging documentation.

### Electron DevTools

When running in development mode:
- **Renderer DevTools**: Automatically opens (React DevTools)
- **Main Process Debugging**: Use VS Code's debugger or Chrome DevTools

**VS Code Launch Configuration:**
Add to `.vscode/launch.json`:
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Main Process",
      "type": "node",
      "request": "launch",
      "cwd": "${workspaceFolder}",
      "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/electron-vite",
      "args": ["--debug"],
      "outputCapture": "std"
    }
  ]
}
```

---

## Common Commands

### Development

```bash
pnpm dev              # Run app in development mode
pnpm typecheck        # Type checking only
pnpm lint             # ESLint checking
pnpm lint:fix         # Auto-fix ESLint issues
```

### Testing

```bash
pnpm test             # Run Vitest unit tests
pnpm test:ui          # Run Vitest with UI
pnpm test:e2e         # Run Playwright E2E tests
```

### Building

```bash
pnpm build            # Production build (includes typecheck)
pnpm package          # Create installers per OS platform
```

### Database

```bash
# Database is automatically created on first run
# Located at: ~/levante/database.sqlite

# View database schema
sqlite3 ~/levante/database.sqlite ".schema"

# Clear database (for testing)
rm ~/levante/database.sqlite
```

### Git Workflow

```bash
# Keep your fork up-to-date
git checkout develop
git pull upstream develop
git push origin develop

# Create a feature branch
git checkout -b feat/your-feature-name

# After making changes
git add .
git commit -m "feat: your commit message"
git push origin feat/your-feature-name
```

---

## Next Steps

Now that you have Levante running locally, you can:

1. **Explore the Codebase**
   - Read [docs/ARCHITECTURE.md](./ARCHITECTURE.md) for architecture overview
   - Check [CLAUDE.md](../CLAUDE.md) for development patterns

2. **Make Your First Contribution**
   - Read [CONTRIBUTING.md](./CONTRIBUTING.md) for workflow details
   - Find a "good first issue" on GitHub
   - Follow the PR process against `develop` branch

3. **Develop MCP Servers**
   - Read [docs/developer/local-mcp-development.md](./developer/local-mcp-development.md)
   - Test local MCP servers with Levante

4. **Learn More**
   - Browse [docs/](./README.md) for all documentation
   - Check [docs/ADR/](./ADR/) for architectural decisions
   - Review [docs/PRD/](./PRD/) for product requirements

---

## Troubleshooting

### Common Issues

#### Issue: "pnpm: command not found"

**Solution:**
```bash
npm install -g pnpm
```

#### Issue: "Port already in use"

**Solution:**
Kill the process using the port:
```bash
# Find process using port 5173 (Vite dev server)
lsof -ti:5173 | xargs kill -9  # macOS/Linux
netstat -ano | findstr :5173   # Windows
```

#### Issue: "Cannot find module"

**Solution:**
```bash
# Clean install
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

#### Issue: "Database locked"

**Solution:**
```bash
# Close all Levante instances
pkill -f levante
# Or restart the app
```

#### Issue: Electron window not opening

**Solution:**
```bash
# Check console for errors
pnpm dev

# Try clearing Electron cache
rm -rf ~/Library/Application\ Support/levante  # macOS
rm -rf %APPDATA%/levante  # Windows
```

---

## Getting Help

If you encounter issues not covered here:

1. Check [GitHub Issues](https://github.com/levante-hub/levante/issues)
2. Search existing discussions
3. Create a new issue with:
   - Steps to reproduce
   - Expected vs actual behavior
   - Relevant logs
   - System information (OS, Node version, etc.)

---

## Additional Resources

- [Architecture Overview](./ARCHITECTURE.md)
- [Contributing Guide](./CONTRIBUTING.md)
- [Logging Documentation](./LOGGING.md)
- [Developer Documentation](./developer/README.md)
- [MCP Development Guide](./developer/local-mcp-development.md)
