# Contributing to Levante

Thank you for your interest in contributing to Levante! We welcome contributions from the community and are grateful for your help in making Levante better.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Branch Strategy](#branch-strategy)
- [Making Changes](#making-changes)
- [Pull Request Process](#pull-request-process)
- [Commit Guidelines](#commit-guidelines)
- [Code Review](#code-review)
- [Testing](#testing)
- [Documentation](#documentation)
- [Getting Help](#getting-help)

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment. We expect all contributors to:

- Be respectful and constructive in discussions
- Welcome newcomers and help them get started
- Focus on what is best for the community
- Show empathy towards other community members

Report unacceptable behavior to support@levante.app.

## Getting Started

Before contributing, please:

1. **Read the documentation**
   - [Getting Started Guide](./docs/GETTING_STARTED.md) - Set up your development environment
   - [Architecture Overview](./docs/ARCHITECTURE.md) - Understand the codebase structure
   - [CLAUDE.md](./CLAUDE.md) - Development patterns and conventions

2. **Check existing issues**
   - Browse [open issues](https://github.com/levante-hub/levante/issues)
   - Look for issues labeled `good first issue` or `help wanted`
   - Comment on an issue if you want to work on it

3. **Set up your environment**
   - Follow the [Getting Started Guide](./docs/GETTING_STARTED.md)
   - Ensure all tests pass: `pnpm test`
   - Verify the app runs: `pnpm dev`

## Development Workflow

Levante uses a **fork-based workflow** with feature branches. Here's the complete process:

### 1. Fork the Repository

Fork the repository to your GitHub account:

1. Go to [github.com/levante-hub/levante](https://github.com/levante-hub/levante)
2. Click the **Fork** button
3. Clone your fork:

```bash
git clone https://github.com/YOUR_USERNAME/levante.git
cd levante
```

### 2. Configure Remotes

Add the upstream repository as a remote:

```bash
# Add upstream remote
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

### 3. Keep Your Fork Synced

Before starting work, always sync with upstream:

```bash
# Switch to develop branch
git checkout develop

# Fetch upstream changes
git fetch upstream

# Merge upstream changes
git merge upstream/develop

# Push to your fork
git push origin develop
```

### 4. Create a Feature Branch

Create a new branch from `develop` for your work:

```bash
# Ensure you're on develop
git checkout develop

# Create and switch to a new feature branch
git checkout -b feat/your-feature-name
```

**Branch naming conventions:**
- `feat/feature-name` - New features
- `fix/bug-description` - Bug fixes
- `docs/what-changed` - Documentation changes
- `refactor/what-refactored` - Code refactoring
- `test/what-tested` - Test additions or updates
- `chore/what-done` - Maintenance tasks

Examples:
```bash
git checkout -b feat/add-dark-mode
git checkout -b fix/chat-history-loading
git checkout -b docs/update-mcp-guide
```

## Branch Strategy

Levante uses a **Git Flow** inspired branching model:

### Main Branches

#### `main`
- **Purpose:** Production-ready releases only
- **Protection:** Requires PR approval, prohibits direct pushes
- **Merges from:** `develop` via release PRs
- **Never commit directly to this branch**

#### `develop`
- **Purpose:** Default branch for development and integration
- **Protection:** Requires PR approval, prohibits direct pushes
- **Merges from:** Feature branches via PRs
- **Base for:** All feature branches

### Supporting Branches

#### Feature Branches
- **Created from:** `develop`
- **Merged back to:** `develop`
- **Naming:** `feat/*`, `fix/*`, `docs/*`, etc.
- **Lifetime:** Deleted after PR is merged

### Branch Protection Rules

Both `main` and `develop` branches are protected:
- Direct pushes are disabled
- Pull requests must have at least 1 approval
- Status checks must pass before merging
- Force pushes are disabled

### Workflow Diagram

```
main (production) ←─────── develop (integration) ←─── feat/your-feature
     │                          │
     │                          ├─── fix/bug-fix
     │                          │
     └── Only release merges    └─── Multiple feature branches
```

## Making Changes

### 1. Develop Your Feature

Make your changes following these guidelines:

**Code Style:**
- Follow existing code patterns
- Use TypeScript strict mode
- Use ESLint and fix all warnings: `pnpm lint:fix`
- Format code with Prettier (automatic on save if configured)

**Architecture:**
- Follow Hexagonal Architecture principles (see [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md))
- Keep main process, preload, and renderer concerns separated
- Use IPC with `levante/*` namespace for cross-process communication

**Import Aliases:**
```typescript
// Use @ alias for renderer imports
import { Button } from '@/components/ui/button'
import { chatStore } from '@/stores/chatStore'

// Absolute imports for main/preload
import { DatabaseService } from '../services/database'
```

### 2. Write Tests

Add tests for new features:

```bash
# Unit tests (Vitest)
pnpm test

# E2E tests (Playwright)
pnpm test:e2e

# Interactive test UI
pnpm test:ui
```

### 3. Update Documentation

If your changes affect:
- User-facing features → Update relevant docs in `docs/`
- Developer APIs → Update `CLAUDE.md` and inline comments
- Configuration → Update `.env` example and `docs/GETTING_STARTED.md`

### 4. Test Your Changes

Before submitting:

```bash
# Type checking
pnpm typecheck

# Linting
pnpm lint

# Tests
pnpm test

# Build verification
pnpm build

# Manual testing
pnpm dev
```

## Pull Request Process

### 1. Commit Your Changes

Follow [Commit Guidelines](#commit-guidelines) below:

```bash
git add .
git commit -m "feat: add dark mode support"
```

### 2. Push to Your Fork

```bash
git push origin feat/your-feature-name
```

### 3. Create Pull Request

1. Go to your fork on GitHub
2. Click **"Compare & pull request"**
3. **Important:** Set the base branch to `develop` (not `main`)
4. Fill out the PR template:

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update

## Related Issue
Closes #123 (if applicable)

## Testing
- [ ] Tests added/updated
- [ ] All tests pass
- [ ] Manual testing completed

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No new warnings introduced
```

### 4. Wait for Review

- At least 1 approval is required
- Address review feedback promptly
- Push updates to the same branch (PR will update automatically)

### 5. Merge

Once approved:
- Maintainers will merge using **"Squash and merge"**
- Your feature branch will be deleted automatically
- Update your local fork:

```bash
git checkout develop
git pull upstream develop
git push origin develop
```

## Commit Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/) specification.

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- **feat:** New feature
- **fix:** Bug fix
- **docs:** Documentation changes
- **style:** Code style changes (formatting, missing semicolons, etc.)
- **refactor:** Code refactoring without behavior change
- **perf:** Performance improvements
- **test:** Adding or updating tests
- **chore:** Maintenance tasks, dependencies, build config
- **ci:** CI/CD pipeline changes

### Examples

```bash
# Simple feature
git commit -m "feat: add dark mode toggle to settings"

# Bug fix with scope
git commit -m "fix(chat): prevent duplicate messages on reconnect"

# Breaking change
git commit -m "feat(api)!: change provider configuration format

BREAKING CHANGE: Provider config now requires 'type' field"

# With body and footer
git commit -m "feat(mcp): add support for local MCP servers

Allow users to configure local MCP servers using uv/uvx for
development and testing purposes.

Closes #456"
```

### Scope (Optional)

Common scopes:
- `chat` - Chat interface and functionality
- `models` - Model management
- `mcp` - MCP integration
- `ui` - User interface components
- `db` - Database
- `api` - API and IPC
- `config` - Configuration management
- `security` - Security features

### Best Practices

- Keep commits atomic (one logical change per commit)
- Write clear, descriptive commit messages
- Use present tense ("add feature" not "added feature")
- Reference issues when applicable (`Closes #123`, `Fixes #456`)
- Keep subject line under 50 characters
- Wrap body at 72 characters

## Code Review

### For Contributors

When your PR is under review:

- **Respond promptly** to feedback
- **Be open** to suggestions and improvements
- **Ask questions** if feedback is unclear
- **Update your PR** by pushing to the same branch
- **Be patient** - reviews may take a few days

### Review Criteria

Reviewers will check for:

- **Functionality:** Does it work as intended?
- **Code Quality:** Is it readable, maintainable, and follows conventions?
- **Tests:** Are there adequate tests with good coverage?
- **Documentation:** Are changes documented appropriately?
- **Performance:** Does it introduce performance issues?
- **Security:** Are there security concerns?
- **Breaking Changes:** Are breaking changes necessary and well-documented?

### Common Feedback

- **Requested changes:** Must be addressed before merge
- **Suggestions:** Optional improvements
- **Questions:** Clarifications needed

## Testing

### Test Requirements

All contributions should include appropriate tests:

#### Unit Tests (Vitest)

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test src/main/services/database.test.ts

# Run with coverage
pnpm test --coverage

# Interactive UI
pnpm test:ui
```

**Location:** Co-locate tests with source files:
```
src/main/services/database.ts
src/main/services/database.test.ts
```

#### E2E Tests (Playwright)

```bash
# Run E2E tests
pnpm test:e2e

# Run specific test
pnpm test:e2e tests/chat.spec.ts

# Debug mode
pnpm test:e2e --debug
```

**Location:** `tests/` directory

### Test Coverage

We aim for:
- **Unit Tests:** 80%+ coverage for services and utilities
- **E2E Tests:** Critical user paths covered

### Manual Testing

Always test your changes manually:
1. Run `pnpm dev`
2. Test happy path scenarios
3. Test error cases
4. Test edge cases
5. Check console for errors/warnings

## Documentation

### When to Update Docs

Update documentation when changing:

- **User-facing features** → `docs/` or `README.md`
- **API or architecture** → `docs/ARCHITECTURE.md`, `docs/ADR/`
- **Developer workflow** → `CLAUDE.md`, `docs/developer/`
- **Configuration** → `docs/GETTING_STARTED.md`, `.env` example

### Documentation Style

- Use clear, concise language
- Include code examples where helpful
- Add diagrams for complex concepts
- Keep formatting consistent with existing docs
- Use Markdown for all documentation

### Examples

Good documentation:
```markdown
## Using the Chat Service

Import and initialize the service:

\`\`\`typescript
import { ChatService } from '@/services/chat'

const chatService = new ChatService()
await chatService.initialize()
\`\`\`

Send a message:

\`\`\`typescript
const response = await chatService.sendMessage({
  content: 'Hello, world!',
  modelId: 'gpt-4'
})
\`\`\`
```

## Getting Help

If you need help contributing:

### Before Asking

1. Search [existing issues](https://github.com/levante-hub/levante/issues)
2. Check [documentation](./docs/)
3. Review [CLAUDE.md](./CLAUDE.md) for patterns

### Where to Ask

- **General questions:** Create a [GitHub Discussion](https://github.com/levante-hub/levante/discussions)
- **Bug reports:** Create an [Issue](https://github.com/levante-hub/levante/issues/new)
- **Feature requests:** Create an [Issue](https://github.com/levante-hub/levante/issues/new) with the feature request template
- **Security issues:** Email support@levante.app (do not create public issues)

### Creating Good Issues

When reporting bugs, include:

```markdown
**Description:**
Brief description of the issue

**Steps to Reproduce:**
1. Go to...
2. Click on...
3. See error...

**Expected Behavior:**
What should happen

**Actual Behavior:**
What actually happens

**Environment:**
- OS: macOS 14.0
- Levante version: 0.1.0
- Node version: 18.x

**Logs:**
Attach relevant logs from ~/Library/Logs/levante/
```

## Recognition

Contributors will be recognized in:
- Project README.md
- Release notes
- GitHub contributors page

Thank you for contributing to Levante!

---

## Quick Reference

### Common Commands

```bash
# Setup
pnpm install              # Install dependencies

# Development
pnpm dev                  # Run in dev mode
pnpm typecheck            # Check types
pnpm lint                 # Lint code
pnpm lint:fix             # Fix linting issues

# Testing
pnpm test                 # Unit tests
pnpm test:e2e             # E2E tests

# Building
pnpm build                # Production build
pnpm package              # Create installers
```

### Git Workflow

```bash
# Sync with upstream
git checkout develop
git pull upstream develop
git push origin develop

# Create feature branch
git checkout -b feat/your-feature

# Commit changes
git add .
git commit -m "feat: your change"
git push origin feat/your-feature

# After PR is merged
git checkout develop
git pull upstream develop
git branch -d feat/your-feature
```

### Key Files

- `CLAUDE.md` - Development patterns
- `docs/GETTING_STARTED.md` - Environment setup
- `docs/ARCHITECTURE.md` - Architecture overview
- `docs/LOGGING.md` - Logging guide
- `docs/developer/` - Developer documentation

---

## Additional Resources

- [Getting Started Guide](./docs/GETTING_STARTED.md)
- [Architecture Documentation](./docs/ARCHITECTURE.md)
- [MCP Development Guide](./docs/developer/local-mcp-development.md)
- [Architectural Decision Records](./docs/ADR/)
- [GitHub Issues](https://github.com/levante-hub/levante/issues)
