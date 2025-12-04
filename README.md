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
  
  <img src="https://1y03izjmgsaiyedf.public.blob.vercel-storage.com/funcionalidades2/multimodal.png" alt="Multimodal chat" width="420" />

- Privacy & security first: local-only storage for chats/settings, encrypted API keys via system keychain, and offline-friendly flows when using local models.
  
- Model Context Protocol (MCP) end-to-end: add servers, browse Tools/Resources/Prompts, and call tools directly from chat with health checks and config import/export.
  
  <img src="https://1y03izjmgsaiyedf.public.blob.vercel-storage.com/funcionalidades2/multimodal.png" alt="MCP end-to-end" width="420" />

- MCP Store & MCP-UI flows: browse/add/manage tools with explicit consent, one-click tool approvals, and audit trails of tool invocations with health insights.
  
  <img src="https://1y03izjmgsaiyedf.public.blob.vercel-storage.com/funcionalidades2/MCP-UI.png" alt="MCP-UI flows" width="420" />

- Guided MCP setup: automatic config extraction from docs/URLs plus runtime diagnostics/resolution so non-technical users can enable servers quickly.

## How to use it

1) Go to this URL (TBD) and download the latest version for your OS (macOS Intel/Apple Silicon, Windows x64, Linux x64).
2) Install or unzip the app for your platform and open it.
3) Complete the short onboarding questionnaire to connect directly to our primary model provider, OpenRouter.
4) Open the MCP Store and add an MCP or use MCPs from different providers:
   
<img src="https://1y03izjmgsaiyedf.public.blob.vercel-storage.com/funcionalidades2/Untitled%20scene.png" alt="MCP Store flows" width="420" />
