# Runtime Installation & Management - PRD

This directory contains the Product Requirements Document (PRD) for implementing automatic runtime installation and management in Levante.

## Overview

**Feature:** Automatic download, installation, and management of runtime dependencies (Node.js, Python, uv, uvx, npx) for MCP servers with a **non-technical user first** approach.

**Status:** Draft - Non-Technical First
**Version:** 2.1
**Created:** 2025-01-23
**Last Updated:** 2025-01-23

## Problem

Users currently must manually install runtime dependencies before using MCP servers, leading to:
- ❌ "npx not found" and "uvx not found" errors
- ❌ Complex platform-specific installation instructions
- ❌ High support burden
- ❌ Poor onboarding experience (15+ minutes to first working MCP server)

## Solution

Implement an **Automatic Runtime Manager** with **non-technical users as primary focus**:
- ✅ **Silent automatic installation** - no prompts by default
- ✅ **Zero technical terminology** in default UI
- ✅ **Progressive disclosure** - advanced options hidden until needed
- ✅ Manages shared runtimes in `~/levante/runtimes/`
- ✅ Identifies runtime requirements from `mcp.json` configuration
- ✅ Provides intelligent priority: Levante → System (fallback) → Silent install
- ✅ Reduces time-to-first-MCP-server from 15 minutes to **< 90 seconds**

## Key Design Philosophy (v2.0)

**"Zero Configuration for Non-Technical, Full Control for Technical"**

### Primary Persona (80%): Non-Technical User "Sarah"
- Has never used terminal
- Doesn't know what Node.js is
- Wants things to "just work"
- **Experience:** Add server → Toast notification "Setting up..." → Server ready ✅

### Secondary Persona (20%): Technical User "Alex"
- Comfortable with terminal
- Has existing runtimes installed
- Wants control and visibility
- **Experience:** Enable "Advanced Mode" → Full runtime management → Detailed progress

## What's New in Version 2.0

**Major Revision:** Complete redesign prioritizing non-technical users

### Key Changes:
1. **🎯 User Personas Added** - Explicit design for Sarah (non-technical) and Alex (technical)
2. **🚀 Silent Installation** - Default behavior: install without prompts (autoInstall: true)
3. **📱 Simple Mode UI** - Toast notifications instead of blocking dialogs
4. **🔧 Advanced Mode** - Opt-in technical controls hidden by default
5. **📖 Two-Track Documentation** - Quick Start (simple) + Advanced Guide (technical)
6. **✨ First-Time Wizard** - 4-screen onboarding, < 60 seconds
7. **💬 Friendly Language** - "Setting up server" not "Installing Node.js runtime"
8. **📊 Mode-Specific Metrics** - Track simple vs advanced user success separately
9. **🧪 User Testing Protocol** - Validation with non-technical users
10. **🎨 Design Principles** - Zero learning curve, progressive disclosure, sensible defaults

### Before (v1.0) vs After (v2.0):

| Aspect | v1.0 | v2.0 |
|--------|------|------|
| **Default behavior** | Prompt user | Install automatically |
| **Progress UI** | Modal dialog (blocking) | Toast notification (non-blocking) |
| **Terminology** | Technical (Node.js, runtime) | Friendly (setting up, server) |
| **Target time** | < 2 minutes | < 90 seconds |
| **User decisions** | Required | Zero (simple mode) |
| **Advanced options** | Mixed with simple | Hidden, opt-in only |
| **Documentation** | Single technical guide | Two tracks (simple/advanced) |
| **Error messages** | Technical | Simple with expandable details |

## What's New in Version 2.1

**Architecture Refinements:** Streamlined configuration and updated versions

### Key Changes:
1. **🌐 Global Developer Mode** - App-wide setting instead of runtime-specific
2. **📦 Latest Versions** - Node.js 22.11.0, Python 3.13.0
3. **🔗 UV Integration** - UV installed with Python via pip (simplified architecture)
4. **⚡ Levante-First Priority** - Use Levante runtimes first for guaranteed compatibility
5. **🏗️ Simplified Structure** - 2 runtime directories (node, python) instead of 3

### Changes from v2.0:

| Aspect | v2.0 | v2.1 |
|--------|------|------|
| **Developer Mode** | Runtime-specific setting | Global app-wide setting |
| **Node.js version** | 20.11.0 | 22.11.0 |
| **Python version** | 3.12.0 | 3.13.0 |
| **UV installation** | Separate directory | Integrated with Python (pip) |
| **Runtime priority** | System → Levante | Levante → System (simple mode) |
| **Runtime directories** | 3 (node, python, uv) | 2 (node, python) |
| **preferSystemRuntimes** | true (default) | false (default) |

## Documents in This Directory

### [PRD-runtime-install.md](./PRD-runtime-install.md)
**Main Product Requirements Document (v2.1 - Non-Technical First)**

Complete PRD with:
- Executive summary and success metrics
- Functional and non-functional requirements
- Technical architecture and data flows
- Implementation plan (5-week roadmap)
- User experience flows and UI mockups
- Testing strategy and security considerations
- Rollout plan and risk analysis

**Sections:**
1. Executive Summary
2. Background & Context
3. Requirements (Functional & Non-Functional)
4. Technical Architecture
5. User Experience
6. Implementation Plan
7. Edge Cases & Error Handling
8. Success Metrics & KPIs
9. Security Considerations
10. Testing Strategy
11. Documentation Requirements
12. Open Questions & Decisions
13. Rollout Plan
14. Dependencies & Risks
15. Appendix

### [raw-runtime-install.md](./raw-runtime-install.md)
**Additional Technical Information & Analysis**

Contains:
- Current state analysis of MCP system
- Runtime detection capabilities (existing)
- Gap analysis
- Technical architecture explorations
- Code examples and implementation patterns
- Platform-specific considerations

## Quick Links

**Related Documentation:**
- [MCP System Diagnostics PRD](../mcp-system-diagnostics.md)
- [Local MCP Development Guide](../../developer/local-mcp-development.md)
- [Configuration Storage Guide](../../guides/configuration-storage.md)

**External References:**
- [Node.js Downloads](https://nodejs.org/dist/)
- [Python Build Standalone](https://github.com/indygreg/python-build-standalone)
- [UV Releases](https://github.com/astral-sh/uv/releases)
- [MCP Specification](https://modelcontextprotocol.io/)

## Key Features

### 1. Automatic Runtime Detection
- Parse MCP server configs to identify required runtime
- Detect `npx` → Node.js, `uvx` → Python + uv, `python` → Python

### 2. Intelligent Resolution Strategy
```
Priority Order (Simple Mode - Default):
1. Levante Runtime (guaranteed compatibility)
2. System Runtime (fallback if Levante not available)
3. Silent Auto-Install (if neither available)

Priority Order (Developer Mode - Optional):
- Configurable via preferSystemRuntimes setting
- Can prioritize System → Levante if desired
```

### 3. Automatic Download & Install
- Download from official sources (nodejs.org, GitHub releases)
- Verify SHA256 checksums
- Extract to `~/levante/runtimes/`
- Create versioned directories with `current` symlink

### 4. Shared Runtime Pool
- Single Node.js installation for all NPX-based servers
- Single Python + uv installation for all UVX-based servers
- Significant disk space savings

### 5. User-Friendly Experience
- Installation dialog with progress tracking
- Clear error messages with actionable steps
- Runtime management UI in settings
- Manual installation instructions as fallback

## Technical Architecture

### Directory Structure
```
~/levante/
├── runtimes/
│   ├── node/
│   │   ├── v22.11.0/
│   │   │   └── bin/ (node, npm, npx)
│   │   └── current -> v22.11.0
│   └── python/
│       ├── 3.13.0/
│       │   └── bin/ (python3, pip3, uv, uvx)
│       └── current -> 3.13.0
└── mcp.json
```

### New Services
- **RuntimeManager** - Install and manage runtimes
- **RuntimeDownloader** - Download with progress tracking
- **RuntimeInstaller** - Extract and verify installations
- **RuntimeResolver** - Resolve runtime paths for MCP servers

### Configuration Extensions
- `ui-preferences.json` - Track installed runtimes, user preferences
- `mcp.json` - Store runtime metadata per server

## Implementation Timeline

| Phase | Duration | Scope |
|-------|----------|-------|
| **Phase 1** | Week 1 | Core infrastructure |
| **Phase 2** | Week 2 | Download & install logic |
| **Phase 3** | Week 3 | Integration with MCP system |
| **Phase 4** | Week 4 | UI components and flows |
| **Phase 5** | Week 5 | Testing and polish |
| **Phase 6** | Future | Optional enhancements |

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Time to first MCP server | ~15 min | < 2 min |
| "Runtime not found" errors | High | < 5% |
| Download success rate | N/A | > 95% |
| Installation success rate | N/A | > 98% |
| Support tickets | Baseline | -90% |

## Security Considerations

- ✅ Download from official sources only (HTTPS)
- ✅ Verify SHA256 checksums
- ✅ Store in user directory (no admin privileges)
- ✅ Validate all paths to prevent traversal
- ✅ Log installations for audit trail

## Platform Support

| Platform | Architecture | Status |
|----------|-------------|--------|
| macOS 14+ | arm64, x64 | ✅ Planned |
| Windows 10+ | x64 | ✅ Planned |
| Linux (Ubuntu/Debian) | x64, arm64 | ✅ Planned |

## Open Questions

1. **Multiple Runtime Versions:** Support multiple Node.js versions simultaneously?
   - **Decision:** Not in Phase 1, add in Phase 2 if needed

2. **Auto-Updates:** Should runtimes auto-update?
   - **Decision:** No, user approval only for stability

3. **System vs Levante Priority:** Always prefer system runtime?
   - **Decision:** Yes by default, allow user override in settings

## Next Steps

1. **Review & Approval**
   - [ ] Product Owner review
   - [ ] Engineering Lead review
   - [ ] Security team review
   - [ ] UX team review

2. **Pre-Implementation**
   - [ ] Set up project board
   - [ ] Create GitHub issues for each phase
   - [ ] Assign engineering resources
   - [ ] Set up telemetry/analytics

3. **Phase 1 Kickoff**
   - [ ] Architecture review meeting
   - [ ] Create feature branch
   - [ ] Begin implementation

## Contact

For questions or feedback about this PRD, please contact the Levante team.

---

**Last Updated:** 2025-01-23
**Document Owner:** Levante Team
**Status:** ✍️ Draft
