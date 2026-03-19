---
name: release
description: Automates the Levante release pipeline (beta from develop, stable from main). Creates version bump commit, annotated tag, pushes to origin, optionally waits for CI, and publishes the draft release with generated notes.
disable-model-invocation: true
---

Run the Levante release pipeline for version: $ARGUMENTS

## Steps

### 1. Preview
Run `bash scripts/release.sh --dry-run $ARGUMENTS` and show the output to the user.
The dry-run shows: branch, type (beta/stable), calculated version, tag, and grouped changelog.

### 2. Confirm
Ask the user via AskUserQuestion: "¿Proceder con el release `<TAG>`?" with options:
- "Sí, crear el release" — describe what will happen (bump, commit, tag, push)
- "Cancelar"

If cancelled, stop here.

### 3. Execute
Run `bash scripts/release.sh --yes --no-ci-wait $ARGUMENTS`

This will:
- Bump `package.json` to the new version
- Create commit `chore(release): <TAG>`
- Create annotated tag `<TAG>`
- Push commit + tag to `origin/<branch>`
- Trigger the CI workflow (`Beta Release Build & Publish` on develop, `Release Build & Publish` on main)

### 4. Wait for CI?
Ask the user via AskUserQuestion: "¿Esperar al CI y publicar el draft release?"
- "Sí, esperar" — proceed to step 5
- "No, lo hago manualmente" — show the run URL and the manual publish command, then stop

### 5. Poll CI
Find the run with:
```
gh run list --workflow="<WORKFLOW_NAME>" --limit=5 --json headBranch,databaseId,status,conclusion,createdAt
```
Filter by `headBranch == "<TAG>"` to get the `databaseId`.

Poll every 30s:
```
gh run view <RUN_ID> --json status,conclusion --jq '[.status,.conclusion] | join(" ")'
```

If CI **fails**:
- Show error and link: `https://github.com/levante-hub/levante/actions/runs/<RUN_ID>`
- Ask the user via AskUserQuestion: "¿Re-lanzar el workflow?"
  - "Sí" → run `gh run rerun <RUN_ID>` and resume polling
  - "No" → stop

### 6. Generate release notes
Once CI succeeds, ask the user via AskUserQuestion: "¿Cómo generar el resumen del release?"
- "Generar automáticamente" → read commits with `git log <PREV_TAG>..<TAG> --pretty=format:"%s"`, filter out merge commits and `chore(release):`, then write a `## What's new` section highlighting the most significant features grouped by theme (Platform, MCP, Chat, etc.)
- "Escribir manualmente" → user provides text via the question's custom input

Build the full release notes:
```
## What's new in <TAG>

<summary — 3-6 bullet highlights of major features>

### ✨ Destacados
<2-4 sentence narrative of the most important changes>

### Features
- feat(...): ...

### Bug Fixes
- fix(...): ...

### Refactoring & Chores
- ...
```

### 7. Publish
```
gh release edit <TAG> --draft=false --notes "<release-notes>" --prerelease   # beta
gh release edit <TAG> --draft=false --notes "<release-notes>" --latest       # stable
```

Report back to the user with the release URL.

---

## Script flags

| Flag | Effect |
|------|--------|
| `--dry-run` | Show summary only, no changes |
| `--yes` | Skip all confirmation prompts |
| `--no-ci-wait` | Skip the CI polling prompt |

## Branch → Release Type

| Branch | Type | Workflow |
|--------|------|----------|
| `develop` | `v1.7.0-beta.1` (prerelease) | `Beta Release Build & Publish` |
| `main` | `v1.7.0` (stable) | `Release Build & Publish` |

## Usage Examples

- `/release` → auto-calculate next version from branch and tags
- `/release 1.8.0` → override base version (suffix auto-added per branch)
- `/release 1.8.0-beta.3` → use explicit version as-is
