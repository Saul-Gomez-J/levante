# Levante - Personal, Secure, Free, Local AI

![Levante Preview](docs/images/Levante_Readme_oficial.png)

Levante is a cross‑platform desktop app (Windows, macOS, Linux) that brings AI tools closer to everyone, not just technical users. It focuses on privacy, clarity, and ease of use with support for multiple AI providers and the Model Context Protocol (MCP).

## Device Compatibility

- macOS (Intel and Apple Silicon)
- Windows (x64)
- Linux (x64)

## Key Features

- Multi-provider AI support: OpenRouter (100+ models with one key), Vercel AI Gateway routing/fallbacks, local models (Ollama, LM Studio, custom endpoints), direct cloud providers (OpenAI, Anthropic, Google, Groq, xAI, Hugging Face), and automatic model sync to keep catalogs updated.
- Multimodal chat: attach images (and optionally audio via ASR/TTS panels) and route to compatible vision/audio models with automatic capability detection.
- Privacy & security first: local-only storage for chats/settings, encrypted API keys via system keychain, and offline-friendly flows when using local models.
- Model Context Protocol (MCP) end-to-end: add servers, browse Tools/Resources/Prompts, and call tools directly from chat with health checks and config import/export.
- MCP Store & MCP-UI flows: browse/add/manage tools with explicit consent, one-click tool approvals, and audit trails of tool invocations with health insights.
- Guided MCP setup: automatic config extraction from docs/URLs plus runtime diagnostics/resolution so non-technical users can enable servers quickly.
