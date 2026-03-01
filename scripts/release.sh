#!/usr/bin/env bash
# =============================================================================
# Levante Release Script
# =============================================================================
# Automates the full release pipeline:
#   - Validates environment (clean tree, branch, gh auth, sync)
#   - Calculates next version (beta from develop, stable from main)
#   - Generates changelog from commits since last tag
#   - Prompts for confirmation before making any changes
#   - Bumps package.json, commits, tags, and pushes
#   - Optionally polls CI and publishes the draft release
#
# Usage:
#   bash scripts/release.sh [options] [version-override]
#
# Options:
#   --yes, -y       Skip all confirmation prompts (for non-interactive use)
#   --dry-run       Show summary only, make no changes
#   --no-ci-wait    Skip the CI polling prompt entirely
#
# Examples:
#   bash scripts/release.sh              # auto-calculate version
#   bash scripts/release.sh 1.8.0        # override base version
#   bash scripts/release.sh 1.8.0-beta.3 # explicit version (used as-is)
#   bash scripts/release.sh --yes        # skip confirmations
#   bash scripts/release.sh --dry-run    # show what would happen
# =============================================================================

set -euo pipefail

# ─── Parse flags ─────────────────────────────────────────────────────────────
AUTO_YES=false
DRY_RUN=false
NO_CI_WAIT=false
POSITIONAL_ARGS=()

for arg in "$@"; do
  case "$arg" in
    --yes|-y)     AUTO_YES=true ;;
    --dry-run)    DRY_RUN=true ;;
    --no-ci-wait) NO_CI_WAIT=true ;;
    *)            POSITIONAL_ARGS+=("$arg") ;;
  esac
done

set -- "${POSITIONAL_ARGS[@]+"${POSITIONAL_ARGS[@]}"}"

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

# ─── Helpers ──────────────────────────────────────────────────────────────────
info()    { echo -e "${BLUE}ℹ${RESET}  $*"; }
success() { echo -e "${GREEN}✓${RESET}  $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET}  $*"; }
error()   { echo -e "${RED}✗${RESET}  $*" >&2; }
header()  { echo -e "\n${BOLD}${CYAN}$*${RESET}"; }
divider() { echo -e "${DIM}────────────────────────────────────────────────────${RESET}"; }

die() {
  error "$*"
  exit 1
}

# ─── 1. VALIDATIONS ──────────────────────────────────────────────────────────
header "Validating environment..."

# Working tree must be clean
if [[ -n "$(git status --porcelain)" ]]; then
  die "Working tree is not clean. Commit or stash your changes first."
fi
success "Working tree is clean"

# Must be on develop or main
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != "develop" && "$BRANCH" != "main" ]]; then
  die "Must be on 'develop' or 'main' branch (currently on '$BRANCH')"
fi
success "Branch: $BRANCH"

# gh CLI must be available and authenticated
if ! command -v gh &>/dev/null; then
  die "'gh' CLI is not installed. Install it from https://cli.github.com"
fi
if ! gh auth status &>/dev/null; then
  die "'gh' CLI is not authenticated. Run: gh auth login"
fi
success "gh CLI authenticated"

# Fetch remote state
git fetch origin "$BRANCH" --quiet

# Check if branch is behind remote
LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse "origin/$BRANCH")"

if [[ "$LOCAL_SHA" != "$REMOTE_SHA" ]]; then
  AHEAD="$(git rev-list "origin/$BRANCH..HEAD" --count)"
  BEHIND="$(git rev-list "HEAD..origin/$BRANCH" --count)"
  if [[ "$BEHIND" -gt 0 ]]; then
    die "Branch '$BRANCH' is $BEHIND commit(s) behind origin/$BRANCH. Run: git pull"
  fi
  if [[ "$AHEAD" -gt 0 ]]; then
    warn "Branch '$BRANCH' is $AHEAD commit(s) ahead of origin/$BRANCH (this is expected for a new release)"
  fi
fi
success "Branch is up to date with origin"

# ─── 2. DETERMINE RELEASE TYPE ────────────────────────────────────────────────
header "Determining release type..."

IS_BETA=false
WORKFLOW_NAME=""

if [[ "$BRANCH" == "develop" ]]; then
  IS_BETA=true
  WORKFLOW_NAME="Beta Release Build & Publish"
  info "Release type: ${YELLOW}beta (prerelease)${RESET}"
else
  WORKFLOW_NAME="Release Build & Publish"
  info "Release type: ${GREEN}stable${RESET}"
fi

# ─── 3. CALCULATE VERSION ─────────────────────────────────────────────────────
header "Calculating version..."

VERSION_OVERRIDE="${1:-}"
FINAL_VERSION=""

# Read current version from package.json
CURRENT_PKG_VERSION="$(node -p "require('./package.json').version")"
# Strip any pre-release suffix to get base semver
BASE_VERSION="${CURRENT_PKG_VERSION%%-*}"

if [[ -n "$VERSION_OVERRIDE" ]]; then
  # User provided an override
  if [[ "$VERSION_OVERRIDE" == *"-beta."* ]]; then
    if [[ "$IS_BETA" == "false" ]]; then
      # On main but passed beta version — strip the beta suffix and warn
      STRIPPED="${VERSION_OVERRIDE%%-beta.*}"
      warn "You're on 'main' but passed a beta version ('$VERSION_OVERRIDE'). Using '$STRIPPED' instead."
      FINAL_VERSION="$STRIPPED"
    else
      FINAL_VERSION="$VERSION_OVERRIDE"
    fi
  else
    # Clean version override (e.g. "1.8.0")
    if [[ "$IS_BETA" == "true" ]]; then
      # On develop — need to find next beta number for this base version
      OVERRIDE_BASE="$VERSION_OVERRIDE"
      LAST_BETA_NUM="$(git tag --list "v${OVERRIDE_BASE}-beta.*" | \
        sed 's/.*-beta\.//' | sort -n | tail -1)"
      if [[ -z "$LAST_BETA_NUM" ]]; then
        NEXT_BETA=1
      else
        NEXT_BETA=$((LAST_BETA_NUM + 1))
      fi
      FINAL_VERSION="${OVERRIDE_BASE}-beta.${NEXT_BETA}"
    else
      FINAL_VERSION="$VERSION_OVERRIDE"
    fi
  fi
else
  # Auto-calculate version
  if [[ "$IS_BETA" == "true" ]]; then
    # Find latest beta tag for BASE_VERSION
    LAST_BETA_NUM="$(git tag --list "v${BASE_VERSION}-beta.*" | \
      sed 's/.*-beta\.//' | sort -n | tail -1)"
    if [[ -z "$LAST_BETA_NUM" ]]; then
      # No beta tags yet for this base version → start at beta.1
      # But first check: is there already a stable tag for this version?
      if git tag --list "v${BASE_VERSION}" | grep -q "v${BASE_VERSION}"; then
        # Current base version already released stably — need to bump minor
        # Split BASE_VERSION into major.minor.patch
        IFS='.' read -r MAJOR MINOR PATCH <<< "$BASE_VERSION"
        NEXT_MINOR=$((MINOR + 1))
        BASE_VERSION="${MAJOR}.${NEXT_MINOR}.0"
        info "v${BASE_VERSION%%-*} already released as stable → bumping to v${BASE_VERSION}"
      fi
      FINAL_VERSION="${BASE_VERSION}-beta.1"
    else
      NEXT_BETA=$((LAST_BETA_NUM + 1))
      FINAL_VERSION="${BASE_VERSION}-beta.${NEXT_BETA}"
    fi
  else
    # Stable: use the clean base version
    FINAL_VERSION="$BASE_VERSION"
  fi
fi

TAG="v${FINAL_VERSION}"

# Check tag doesn't already exist
if git tag --list | grep -q "^${TAG}$"; then
  die "Tag '${TAG}' already exists. Choose a different version or delete the tag first."
fi

success "Version: ${BOLD}${FINAL_VERSION}${RESET}"
success "Tag:     ${BOLD}${TAG}${RESET}"

# ─── 4. GENERATE CHANGELOG ────────────────────────────────────────────────────
header "Generating changelog..."

# Find the last tag to use as range start
LAST_TAG="$(git describe --tags --abbrev=0 2>/dev/null || echo "")"

if [[ -z "$LAST_TAG" ]]; then
  warn "No previous tags found — using all commits (limited to 50)"
  COMMIT_RANGE="HEAD"
  GIT_LOG_CMD="git log --pretty=format:%s HEAD -50"
else
  info "Changes since ${LAST_TAG}"
  GIT_LOG_CMD="git log --pretty=format:%s ${LAST_TAG}..HEAD"
fi

# Collect commits by type
FEAT_COMMITS=""
FIX_COMMITS=""
REFACTOR_COMMITS=""
CHORE_COMMITS=""
DOCS_COMMITS=""
OTHER_COMMITS=""

while IFS= read -r line; do
  # Skip empty lines and release commits
  [[ -z "$line" ]] && continue
  [[ "$line" == chore\(release\):* ]] && continue

  if [[ "$line" == feat* ]]; then
    FEAT_COMMITS="${FEAT_COMMITS}- ${line}\n"
  elif [[ "$line" == fix* ]]; then
    FIX_COMMITS="${FIX_COMMITS}- ${line}\n"
  elif [[ "$line" == refactor* ]]; then
    REFACTOR_COMMITS="${REFACTOR_COMMITS}- ${line}\n"
  elif [[ "$line" == chore* || "$line" == build* || "$line" == ci* ]]; then
    CHORE_COMMITS="${CHORE_COMMITS}- ${line}\n"
  elif [[ "$line" == docs* ]]; then
    DOCS_COMMITS="${DOCS_COMMITS}- ${line}\n"
  else
    OTHER_COMMITS="${OTHER_COMMITS}- ${line}\n"
  fi
done < <(eval "$GIT_LOG_CMD")

# Build changelog string
CHANGELOG=""
[[ -n "$FEAT_COMMITS" ]]     && CHANGELOG="${CHANGELOG}### Features\n${FEAT_COMMITS}\n"
[[ -n "$FIX_COMMITS" ]]      && CHANGELOG="${CHANGELOG}### Bug Fixes\n${FIX_COMMITS}\n"
[[ -n "$REFACTOR_COMMITS" ]] && CHANGELOG="${CHANGELOG}### Refactoring\n${REFACTOR_COMMITS}\n"
[[ -n "$DOCS_COMMITS" ]]     && CHANGELOG="${CHANGELOG}### Documentation\n${DOCS_COMMITS}\n"
[[ -n "$CHORE_COMMITS" ]]    && CHANGELOG="${CHANGELOG}### Chores\n${CHORE_COMMITS}\n"
[[ -n "$OTHER_COMMITS" ]]    && CHANGELOG="${CHANGELOG}### Other\n${OTHER_COMMITS}\n"

if [[ -z "$CHANGELOG" ]]; then
  warn "No commits found since $LAST_TAG"
  CHANGELOG="No changes recorded.\n"
fi

COMMIT_COUNT="$(eval "$GIT_LOG_CMD" | grep -c . || true)"
success "Found ${COMMIT_COUNT} commit(s) since ${LAST_TAG:-the beginning}"

# ─── 5. SHOW SUMMARY ──────────────────────────────────────────────────────────
echo ""
divider
echo -e "  ${BOLD}Release Summary${RESET}"
divider
echo -e "  Branch:    ${CYAN}${BRANCH}${RESET}"
echo -e "  Type:      $([ "$IS_BETA" == "true" ] && echo "${YELLOW}beta (prerelease)${RESET}" || echo "${GREEN}stable${RESET}")"
echo -e "  Version:   ${BOLD}${FINAL_VERSION}${RESET}"
echo -e "  Tag:       ${BOLD}${TAG}${RESET}"
echo -e "  Workflow:  ${DIM}${WORKFLOW_NAME}${RESET}"
echo ""
echo -e "  ${BOLD}Changelog:${RESET}"
echo -e "${CHANGELOG}" | sed 's/^/  /'
divider
echo ""

# ─── 6. CONFIRM ───────────────────────────────────────────────────────────────
if [[ "$DRY_RUN" == "true" ]]; then
  echo -e "${YELLOW}Dry run — no changes made.${RESET}"
  exit 0
fi

if [[ "$AUTO_YES" == "true" ]]; then
  info "Auto-confirming release ${TAG} (--yes flag)"
else
  read -r -p "$(echo -e "${BOLD}Proceed with release ${TAG}? [y/N]:${RESET} ")" CONFIRM
  echo ""
  CONFIRM_LOWER="$(echo "$CONFIRM" | tr '[:upper:]' '[:lower:]')"
  if [[ "$CONFIRM_LOWER" != "y" && "$CONFIRM_LOWER" != "yes" ]]; then
    info "Release cancelled."
    exit 0
  fi
fi

# ─── 7. BUMP package.json ─────────────────────────────────────────────────────
header "Bumping package.json..."

node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = '${FINAL_VERSION}';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log('package.json updated to ' + pkg.version);
"
success "package.json → ${FINAL_VERSION}"

# ─── 8. COMMIT ────────────────────────────────────────────────────────────────
header "Creating release commit..."

git add package.json
git commit -m "chore(release): ${TAG}"
success "Committed: chore(release): ${TAG}"

# ─── 9. TAG ───────────────────────────────────────────────────────────────────
header "Creating annotated tag..."

if [[ "$IS_BETA" == "true" ]]; then
  TAG_MESSAGE="${TAG}"
else
  # For stable, include a brief summary in the tag message
  TAG_MESSAGE="${TAG}"
fi

git tag -a "${TAG}" -m "${TAG_MESSAGE}"
success "Tagged: ${TAG}"

# ─── 10. PUSH ─────────────────────────────────────────────────────────────────
header "Pushing to origin..."

git push origin "${BRANCH}"
git push origin "${TAG}"
success "Pushed commit and tag to origin/${BRANCH}"

echo ""
echo -e "${GREEN}${BOLD}Release ${TAG} triggered!${RESET}"
echo -e "${DIM}CI workflow '${WORKFLOW_NAME}' should start shortly.${RESET}"
echo ""

# ─── 11. OPTIONAL: WAIT FOR CI & PUBLISH DRAFT ────────────────────────────────
if [[ "$NO_CI_WAIT" == "true" ]]; then
  WAIT_CI="n"
elif [[ "$AUTO_YES" == "true" ]]; then
  WAIT_CI="y"
else
  read -r -p "$(echo -e "${BOLD}Wait for CI to complete and publish the draft release? [y/N]:${RESET} ")" WAIT_CI
  echo ""
fi

WAIT_CI_LOWER="$(echo "$WAIT_CI" | tr '[:upper:]' '[:lower:]')"
if [[ "$WAIT_CI_LOWER" != "y" && "$WAIT_CI_LOWER" != "yes" ]]; then
  REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
  info "Skipping CI wait. Check status at: https://github.com/${REPO}/actions"
  info "After CI completes, publish the draft release with:"
  echo -e "  ${DIM}gh release edit ${TAG} --draft=false${RESET}"
  exit 0
fi

# ─── 12. POLL CI ──────────────────────────────────────────────────────────────
header "Waiting for CI workflow to start..."

POLL_INTERVAL=30
MAX_WAIT=1800  # 30 minutes
ELAPSED=0
RUN_ID=""

# Give GitHub a moment to register the push
sleep 5

# Find the workflow run triggered by our tag
while [[ -z "$RUN_ID" && $ELAPSED -lt 120 ]]; do
  RUN_ID="$(gh run list \
    --workflow="${WORKFLOW_NAME}" \
    --limit=5 \
    --json headBranch,databaseId,status,createdAt \
    --jq ".[] | select(.headBranch == \"${TAG}\") | .databaseId" 2>/dev/null | head -1 || true)"

  if [[ -z "$RUN_ID" ]]; then
    echo -ne "\r${DIM}Waiting for run to appear... ${ELAPSED}s${RESET}"
    sleep 10
    ELAPSED=$((ELAPSED + 10))
  fi
done

if [[ -z "$RUN_ID" ]]; then
  warn "Could not find the CI run for tag '${TAG}' after ${ELAPSED}s"
  REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
  info "Check manually at: https://github.com/${REPO}/actions"
  exit 1
fi

echo ""
success "Found CI run: ${RUN_ID}"
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
info "Tracking: https://github.com/${REPO}/actions/runs/${RUN_ID}"

# Poll until completion
ELAPSED=0
while [[ $ELAPSED -lt $MAX_WAIT ]]; do
  RUN_STATUS="$(gh run view "$RUN_ID" --json status,conclusion \
    --jq '"status=\(.status) conclusion=\(.conclusion)"' 2>/dev/null || echo "status=unknown conclusion=")"

  STATUS="${RUN_STATUS#status=}"
  STATUS="${STATUS%% *}"
  CONCLUSION="${RUN_STATUS##*conclusion=}"

  if [[ "$STATUS" == "completed" ]]; then
    echo ""
    if [[ "$CONCLUSION" == "success" ]]; then
      success "CI completed successfully!"
    else
      echo ""
      error "CI completed with conclusion: ${CONCLUSION}"
      info "Run details: https://github.com/${REPO}/actions/runs/${RUN_ID}"
      die "CI failed — not publishing draft release."
    fi
    break
  fi

  # Show progress
  MINUTES=$((ELAPSED / 60))
  SECONDS_REM=$((ELAPSED % 60))
  echo -ne "\r${DIM}CI running... ${MINUTES}m${SECONDS_REM}s (status: ${STATUS})${RESET}   "
  sleep "$POLL_INTERVAL"
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
done

if [[ $ELAPSED -ge $MAX_WAIT ]]; then
  warn "CI polling timed out after ${MAX_WAIT}s"
  info "Run details: https://github.com/${REPO}/actions/runs/${RUN_ID}"
  die "Timed out waiting for CI — not publishing draft release."
fi

# ─── 13. PUBLISH DRAFT RELEASE ────────────────────────────────────────────────
header "Publishing draft release..."

# Build release notes from changelog
RELEASE_NOTES="$(printf '%b' "${CHANGELOG}")"

# Wait briefly for the release to be created by CI (if it wasn't pre-existing)
sleep 5

# Retry up to 3 times in case release isn't created yet
PUBLISHED=false
for i in 1 2 3; do
  if gh release edit "${TAG}" \
    --draft=false \
    --notes "${RELEASE_NOTES}" \
    $([ "$IS_BETA" == "true" ] && echo "--prerelease" || echo "--latest") \
    2>/dev/null; then
    PUBLISHED=true
    break
  fi
  if [[ $i -lt 3 ]]; then
    warn "Release not found yet, retrying in 10s... (attempt $i/3)"
    sleep 10
  fi
done

if [[ "$PUBLISHED" == "true" ]]; then
  echo ""
  echo -e "${GREEN}${BOLD}✓ Release ${TAG} published successfully!${RESET}"
  RELEASE_URL="$(gh release view "${TAG}" --json url -q .url 2>/dev/null || echo "")"
  [[ -n "$RELEASE_URL" ]] && info "View at: ${RELEASE_URL}"
else
  warn "Could not publish the draft release automatically."
  info "Publish manually with:"
  echo -e "  ${DIM}gh release edit ${TAG} --draft=false$([ "$IS_BETA" == "true" ] && echo " --prerelease" || echo " --latest")${RESET}"
fi
