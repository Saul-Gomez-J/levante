# Levante - Personal, Secure, Free, Local AI

<p align="center">
  <img src="docs/images/Levante_Readme_oficial.png" alt="Levante Preview" />
</p>

Levante is a cross‑platform desktop app (Windows, macOS, Linux) that brings AI tools closer to everyone, not just technical users. It focuses on privacy, clarity, and ease of use with support for multiple AI providers and the Model Context Protocol (MCP).

## Device Compatibility

- macOS (Intel and Apple Silicon)
- Windows (x64)
- Linux (x64)

## Key Features

- Multi-provider AI support: OpenRouter (100+ models with one key), Vercel AI Gateway routing/fallbacks, local models (Ollama, LM Studio, custom endpoints), direct cloud providers (OpenAI, Anthropic, Google, Groq, xAI, Hugging Face), and automatic model sync to keep catalogs updated.
- Multimodal chat: attach images (and optionally audio via ASR/TTS panels) and route to compatible vision/audio models with automatic capability detection.

<p align="center">
  <img src="https://1y03izjmgsaiyedf.public.blob.vercel-storage.com/funcionalidades2/multimodal.png" alt="Multimodal chat" width="420" />
</p>

- Privacy & security first: local-only storage for chats/settings, encrypted API keys via system keychain, and offline-friendly flows when using local models.
  
- Model Context Protocol (MCP) end-to-end: compatibility with:
- -> Tools 
- -> Prompts
- -> Resources

<p align="center">
  <img src="https://1y03izjmgsaiyedf.public.blob.vercel-storage.com/funcionalidades2/MCP-functionalities.png" alt="MCP end-to-end" width="420" />
</p>

- MCP Store & MCP-UI flows: one of the few MCP clientes that implements this.

<p align="center">
  <img src="https://1y03izjmgsaiyedf.public.blob.vercel-storage.com/funcionalidades2/MCP-UI.png" alt="MCP-UI flows" width="420" />
</p>

- Guided MCP setup: automatic config extraction from docs/URLs plus runtime diagnostics/resolution so non-technical users can enable servers quickly.

## How to use it

1) Go to this URL (TBD) and download the latest version for your OS (macOS Intel/Apple Silicon, Windows x64, Linux x64).
2) Install or unzip the app for your platform and open it.
3) Complete the short onboarding questionnaire to connect directly to our primary model provider, OpenRouter.
4) Open the MCP Store and add an MCP or use MCPs from different providers:
   
<p align="center">
  <img src="https://1y03izjmgsaiyedf.public.blob.vercel-storage.com/funcionalidades2/Untitled%20scene.png" alt="MCP Store flows" width="620" />
</p>

## Contributing

We welcome contributions. Set up your environment with `docs/GETTING_STARTED.md` and follow the workflow in `CONTRIBUTING.md`—both contain the full guidelines.

## Contributors

<div style="display: flex; gap: 16px; align-items: center; justify-content: center; flex-wrap: wrap;">
  <img src="https://1y03izjmgsaiyedf.public.blob.vercel-storage.com/Perfiles%20Linkedin/saul.jpeg" alt="Saul" width="120" style="border-radius: 50%;" />
  <img src="https://1y03izjmgsaiyedf.public.blob.vercel-storage.com/Perfiles%20Linkedin/oliver.jpeg" alt="Oliver" width="120" style="border-radius: 50%;" />
  <img src="https://1y03izjmgsaiyedf.public.blob.vercel-storage.com/Perfiles%20Linkedin/Alejandro.jpeg" alt="Alejandro" width="120" style="border-radius: 50%;" />
  <img src="https://1y03izjmgsaiyedf.public.blob.vercel-storage.com/Perfiles%20Linkedin/Dennis.jpeg" alt="Dennis" width="120" style="border-radius: 50%;" />
  <img src="https://1y03izjmgsaiyedf.public.blob.vercel-storage.com/Perfiles%20Linkedin/Mauro.jpeg" alt="Mauro" width="120" style="border-radius: 50%;" />
  <img src="https://1y03izjmgsaiyedf.public.blob.vercel-storage.com/Perfiles%20Linkedin/Javier.jpeg" alt="Javier" width="120" style="border-radius: 50%;" />
</div>

Join our community on Discord to stay updated: https://discord.gg/Ane83d2EFG.
