# OpenClaw MiMo TTS Provider

A native TypeScript speech synthesis plugin for [OpenClaw](https://github.com/openclaw/openclaw) that integrates Xiaomi MiMo V2 TTS.

## What Problem Does This Solve

OpenClaw's built-in TTS providers (OpenAI, ElevenLabs, etc.) are not compatible with the Xiaomi MiMo V2 speech synthesis model endpoint. MiMo V2 delivers high-quality Chinese and English speech synthesis with `<style>` tag support for fine-grained prosody control.

## How It Works

The plugin is built on the **OpenClaw Plugin SDK** (`openclaw/plugin-sdk/*`) and registers a **Speech Provider** (`mimo-tts-provider`) that handles text-to-speech via Xiaomi's Chat Completions API. MiMo V2 uses a non-standard TTS interface: rather than a dedicated `/audio/speech` endpoint, it accepts TTS requests through `/v1/chat/completions` with a `messages` array and an `audio` configuration object.

### Architecture

```
User sends /say command
        │
        ▼
   LLM Agent composes answer
        │
        ▼
   OpenClaw TTS runtime routes to mimo-tts-provider
        │
        ▼
   synthesize()
   ├── resolveConfig() — reads API key, voice, style, format
   ├── prependStyle()  — merges style tags
   ├── extracts <user> context from text
   └── callMimoApi()  — POST to /v1/chat/completions
        │
        ▼
   MiMo returns base64-encoded audio in the response JSON
        │
        ▼
   Audio buffer returned to OpenClaw for playback
```

### User Context Extraction

When the agent appends `<user>original question</user>` at the end of the text, the plugin extracts it and passes it as a separate `user` message in the API request. This gives MiMo conversational context for more natural intonation:

```json
{
  "messages": [
    { "role": "user", "content": "What is the capital of France?" },
    { "role": "assistant", "content": "<style>cheerful</style>The capital of France is Paris!" }
  ],
  "audio": { "format": "wav", "voice": "default_zh" }
}
```

## Configuration

### `openclaw.json` Settings

Place the following under `messages.tts.providers.mimo-tts-provider` in your OpenClaw config:

| Field | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| `apiKey` | `string` | — | **Yes** | Xiaomi MiMo API key. Can also be set via `XIAOMI_API_KEY` environment variable. Config value takes precedence when both are present. |
| `apiBase` | `string` | `https://api.xiaomimimo.com/v1` | No | MiMo API base URL. The plugin appends `/chat/completions`. Override when using a proxy or custom endpoint. |
| `voice` | `string` | `default_zh` | No | Default voice ID. Valid values: `mimo_default`, `default_zh`, `default_en`. Invalid values fall back to `default_zh`. |
| `style` | `string` | `""` (empty) | No | Default style token prepended to every synthesis request as `<style>{value}</style>`. Examples: `calm`, `cheerful gentle`, `sad slow`. |
| `format` | `string` | `wav` | No | Audio output format passed directly to the MiMo API. Common values: `wav`, `mp3`. |

### `/say` Command

Once registered, use `/say` in any channel to have the agent reply with synthesized speech.

```
/say How is the weather today?
Reply: voice message
```

### Style Tags

See the official MiMo V2 TTS style guide for full details: https://platform.xiaomimimo.com/docs/tts-style-guide

## Supported Styles

MiMo V2 supports both Chinese and English style tokens. **Chinese tokens are recommended** for more accurate results. Verified tokens include:

| Token | Effect |
|-------|--------|
| `开心` | Cheerful, upbeat tone |
| `伤心` | Sad, heavy tone |
| `温柔` | Soft, warm delivery |
| `快速` | Faster speech rate |
| `甜美女生` | Sweet, cute female voice |
| `林黛玉` | Fragile, melancholy character voice |
| `唱歌` | Musical, melodic delivery |

Multiple styles can be combined: `<style>温柔 开心</style>`

## Supported Voices

| Voice ID | Description |
|----------|-------------|
| `mimo_default` | MiMo default voice |
| `default_zh` | Chinese-optimized voice (default) |
| `default_en` | English-optimized voice |

## Setup

### Prerequisites

- [OpenClaw](https://github.com/openclaw/openclaw) installed and running (v2026.3.24-beta.2 or later)
- Node.js >= 22
- A Xiaomi MiMo API key (apply at [platform.xiaomimimo.com](https://platform.xiaomimimo.com))

### Step 1: Clone the Repository

```bash
git clone https://github.com/liciheng1998/openclaw-mimo-tts.git
cd openclaw-mimo-tts
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Build the Plugin

The plugin is written in TypeScript and must be compiled:

```bash
npx tsc
```

Compiled output (`.js` and `.d.ts` files) will be written to `dist/`.

### Step 4: Install into OpenClaw

Copy the plugin directory to OpenClaw's plugins folder:

**macOS / Linux:**
```bash
cp -r . ~/.openclaw/plugins/mimo-tts-provider
```

**Windows (PowerShell):**
```powershell
Copy-Item -Recurse . $env:USERPROFILE\.openclaw\plugins\mimo-tts-provider
```

### Step 5: Configure OpenClaw

Add the plugin configuration to `~/.openclaw/openclaw.json`:

```json5
{
  messages: {
    tts: {
      provider: "mimo-tts-provider",
      providers: {
        "mimo-tts-provider": {
          apiKey: "your-xiaomi-api-key",
          voice: "default_zh",
          style: "calm",
          format: "wav"
        }
      }
    }
  },
  plugins: {
    entries: {
      "mimo-tts-provider": {
        enabled: true
      }
    }
  }
}
```

Or set the API key via environment variable:

```bash
export XIAOMI_API_KEY=your-xiaomi-api-key
```

### Step 6: Restart OpenClaw Gateway

```bash
openclaw gateway restart
```

### Step 7: Test

Send a `/say` command in any OpenClaw channel (Telegram, Discord, etc.):

```
/say Hello, how is the weather today?
```

The agent should reply with synthesized audio.

## Project Structure

```
mimo-tts-provider/
├── index.ts              # Plugin entry — registers the speech provider
├── config.ts             # Config resolution (API key, voice, style, format)
├── mimo-api.ts           # MiMo API HTTP client
├── package.json          # npm package metadata and OpenClaw plugin manifest
├── openclaw.plugin.json  # OpenClaw plugin discovery manifest
└── .gitignore
```

### Core Files

- **`index.ts`** — Main entry point. Registers the `mimo-tts-provider` speech provider. Handles style merging, user context extraction, and voice validation.
- **`config.ts`** — Config resolution with priority: provider config > global config > environment variable. Config source is logged for easy debugging.
- **`mimo-api.ts`** — HTTP client. POSTs to MiMo's `/v1/chat/completions` endpoint with timeout and error handling.

### Logging

All plugin logs are prefixed with `[mimo-tts]`. Key log events include:

- Config resolution (API key is masked, source is shown)
- Voice validation and fallback
- Style merging
- User context extraction
- API request details (endpoint, timeout)
- API response latency
- Audio buffer size

## License

MIT License
