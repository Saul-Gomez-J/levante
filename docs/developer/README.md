# Developer Documentation

This directory contains technical documentation for developers working on or extending Levante.

## Getting Started

### [Getting Started Guide](../GETTING_STARTED.md)
Complete setup guide for new developers. Covers:
- Prerequisites and system requirements
- Fork and clone workflow
- Environment configuration (.env setup)
- Running the application
- Log locations and debugging
- Common commands and troubleshooting

### [Contributing Guide](../../CONTRIBUTING.md)
Complete contribution workflow guide. Covers:
- Fork-based development workflow
- Branch strategy (main/develop)
- Pull request process targeting `develop`
- Commit guidelines (Conventional Commits)
- Code review process
- Testing requirements

## Development Guides

### [Local MCP Server Development](./local-mcp-development.md)
Complete guide for developing and testing MCP (Model Context Protocol) servers locally with Levante. Covers:
- Different execution methods (`uvx`, `uv run`, `python -m`)
- Configuration examples
- Security considerations
- Troubleshooting common issues

## Architecture & Design

- [Architecture Overview](../ARCHITECTURE.md) - System architecture and design patterns
- [Architectural Decision Records](../ADR/) - Key architectural decisions
- [Tech Spec](../TECH_SPEC.md) - Technical specifications
- [Hexagonal Architecture ADR](../ADR/0005-hexagonal-architecture.md) - Architecture principles

## API & Integration

- [MCP Documentation](../MCP.md) - Model Context Protocol integration
- [MCP Deep Link Security](../MCP_DEEP_LINK_SECURITY.md) - Security for MCP deep links
- [AI Models](../AI_MODELS.md) - AI provider integration
- [Deep Linking](../DEEP_LINKING.md) - Deep link protocol

## Configuration & Storage

- [Configuration Storage Guide](../guides/configuration-storage.md) - Settings and encryption
- [Logging Documentation](../LOGGING.md) - Logging system and configuration

## Security

- [Security Guidelines](../SECURITY.md) - Security best practices
- [Security Test Cases](../SECURITY_TEST_CASES.md) - Security testing
- [Security Documentation](../security/) - Detailed security audits and implementations

## Testing & Quality

- Testing strategy documented in [CLAUDE.md](../../CLAUDE.md#development-patterns)
- Build and packaging info in [GETTING_STARTED.md](../GETTING_STARTED.md#common-commands)
- Release process in [Release Guide](../guides/release-process.md)

## Product Documentation

- [Product Requirements](../PRD/) - Feature requirements and specifications
- [UX Guidelines](../UX/UX_GUIDELINES.md) - User experience guidelines
- [Release Process](../guides/release-process.md) - How to create releases

## Quick Links

| Task | Documentation |
|------|--------------|
| Set up development environment | [Getting Started](../GETTING_STARTED.md) |
| Make your first contribution | [Contributing Guide](../../CONTRIBUTING.md) |
| Develop MCP servers | [Local MCP Development](./local-mcp-development.md) |
| Understand architecture | [Architecture Overview](../ARCHITECTURE.md) |
| Configure logging | [Logging Documentation](../LOGGING.md) |
| Review security | [Security Guidelines](../SECURITY.md) |

## Additional Resources

- [Main Documentation](../)
- [GitHub Repository](https://github.com/levante-hub/levante)
- [CLAUDE.md](../../CLAUDE.md) - Development patterns for AI assistants
