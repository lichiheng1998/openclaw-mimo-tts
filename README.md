# OpenClaw MiMo TTS Provider

A native TypeScript speech provider plugin for [OpenClaw](https://github.com/openclaw/openclaw) that integrates Xiaomi MiMo V2 TTS into the OpenClaw agent ecosystem.

## Problem

OpenClaw's built-in TTS providers (OpenAI, ElevenLabs, etc.) require paid API keys and don't natively support Xiaomi's MiMo V2 speech synthesis model. MiMo V2 offers high-quality Chinese and English TTS with granular prosody control via `<style>` tags — a feature unique to Xiaomi's API that other providers don't offer. This plugin bridges that gap, making MiMo V2 a first-class speech provider in OpenClaw.

## Implementation

The plugin is built on the **OpenClaw Plugin SDK** (`openclaw/plugin-sdk/*`) and registers two capabilities:

1. **Speech Provider** (`mimo-tts-provider`) — Handles text-to-speech synthesis via Xiaomi's Chat Completions API. MiMo V2 uses a non-standard TTS interface: instead of a dedicated `/audio/speech` endpoint, it accepts TTS requests through the `/v1/chat/completions` endpoint with a `messages` array and an `audio` config object.

2. **Agent Tool** (`mimo_tts_say`) — A tool the LLM agent can invoke when the user sends a `/say` command. The agent composes an answer, appends the original question as `<user>...</user>` context, and calls this tool to synthesize and deliver speech.

### Architecture

```
User sends /say command
        │
        ▼
   LLM Agent composes answer
        │
        ▼
   mimo_tts_say tool invoked
        │
        ▼
   OpenClaw TTS runtime routes to mimo-tts-provider
        │
        ▼
   synthesize() called
   ├── resolveConfig() — reads API key, voice, style, format
   ├── prependStyle() — merges style tags
   ├── Extracts <user> context from text
   └── callMimoApi() — POST to /v1/chat/completions
        │
        ▼
   MiMo returns base64 audio in response JSON
        │
        ▼
   Audio buffer returned to OpenClaw for delivery
```

### Style Tag System

MiMo V2 supports inline `<style>...</style>` tags in the text input to control prosody (emotion, pacing, emphasis). The plugin merges a default style from config with any style tags the LLM writes directly:

| Scenario | Input | Sent to API |
|----------|-------|-------------|
| Config style only | `Hello world` | `<style>calm</style>Hello world` |
| LLM style + config | `<style>happy</style>Great news!` | `<style>happy calm</style>Great news!` |
| LLM style only (no config) | `<style>sad</style>Oh no...` | `<style>sad</style>Oh no...` |
| Duplicate tokens | `<style>calm gentle</style>...` + config `calm` | `<style>calm gentle</style>...` |

### User Context Extraction

When the agent appends `<user>original question</user>` at the end of the text, the plugin extracts it and sends it as a separate `user` message in the API request. This gives MiMo conversational context for more natural intonation:

```json
{
  "messages": [
    { "role": "user", "content": "What is the capital of France?" },
    { "role": "assistant", "content": "<style>cheerful</style>The capital of France is Paris!" }
  ],
  "audio": { "format": "wav", "voice": "default_zh" }
}
```

## Parameters

### Configuration (`openclaw.json`)

These go under `messages.tts.providers.mimo-tts-provider` in your OpenClaw config:

| Parameter | Type | Default | Required | Description |
|-----------|------|---------|----------|-------------|
| `apiKey` | `string` | — | **Yes** | Xiaomi MiMo API key. Can also be set via `XIAOMI_API_KEY` environment variable. If both are set, the config value takes precedence. |
| `apiBase` | `string` | `https://api.xiaomimimo.com/v1` | No | MiMo API base URL. The plugin appends `/chat/completions` to this. Override if using a proxy or custom endpoint. |
| `voice` | `string` | `default_zh` | No | Default voice ID. Valid values: `mimo_default`, `default_zh`, `default_en`. Invalid values fall back to `default_zh`. |
| `style` | `string` | `""` (empty) | No | Default style tokens prepended to every synthesis request. Written as `<style>{value}</style>` in the API call. Examples: `calm`, `cheerful gentle`, `sad slow`. |
| `format` | `string` | `wav` | No | Audio output format. Passed directly to MiMo API. Common values: `wav`, `mp3`. |

### Example Config

```json5
{
  messages: {
    tts: {
      provider: "mimo-tts-provider",
      mimoTts: {
        apiKey: "your-xiaomi-api-key",
        apiBase: "https://api.xiaomimimo.com/v1",
        voice: "default_zh",
        style: "calm",
        format: "wav"
      }
    }
  }
}
```

### Environment Variable (Alternative)

Instead of putting the API key in config, you can set:

```bash
export XIAOMI_API_KEY=your-xiaomi-api-key
```

The plugin checks config first, then falls back to the environment variable.

### Agent Tool: `mimo_tts_say`

When registered, the agent can use this tool to synthesize speech. The tool takes one parameter:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `text` | `string` | **Yes** | The spoken answer text. Can include `<style>...</style>` prefix for prosody control. Must include `<user>...</user>` at the end with the original user question for context. |

**Format:** `[<style>tokens</style>]answer text<user>original question</user>`

**Example:**
```
<style>cheerful</style>Great question! The capital of France is Paris.<user>What is the capital of France?</user>
```

### Supported Style Tokens

MiMo V2 accepts free-form style tokens. Common ones include:

| Token | Effect |
|-------|--------|
| `calm` | Relaxed, steady pace |
| `cheerful` | Upbeat, positive tone |
| `sad` | Somber, slower pace |
| `gentle` | Soft, warm delivery |
| `excited` | Energetic, faster pace |
| `serious` | Formal, measured |
| `whisper` | Quiet, intimate |
| `singing` | Musical, melodic delivery |

Multiple tokens can be combined: `<style>calm gentle</style>`

### Supported Voices

| Voice ID | Description |
|----------|-------------|
| `mimo_default` | MiMo default voice |
| `default_zh` | Chinese-optimized voice (default) |
| `default_en` | English-optimized voice |

## Setup (After Cloning)

### Prerequisites

- [OpenClaw](https://github.com/openclaw/openclaw) installed and running (v2026.3.24-beta.2 or later)
- Node.js >= 22
- A Xiaomi MiMo API key (get one at [platform.xiaomimimo.com](https://platform.xiaomimimo.com))

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

The plugin is written in TypeScript and needs to be compiled:

```bash
npx tsc
```

This outputs compiled `.js` and `.d.ts` files to the `dist/` directory.

### Step 4: Install into OpenClaw

Copy or symlink the plugin directory into OpenClaw's plugin directory:

```bash
# Option A: Copy
cp -r . ~/.openclaw/plugins/mimo-tts-provider

# Option B: Symlink (for development — changes reflect after rebuild)
ln -s $(pwd) ~/.openclaw/plugins/mimo-tts-provider
```

On Windows (PowerShell):
```powershell
# Copy
Copy-Item -Recurse . $env:USERPROFILE\.openclaw\plugins\mimo-tts-provider

# Or symlink (requires admin)
New-Item -ItemType SymbolicLink -Path "$env:USERPROFILE\.openclaw\plugins\mimo-tts-provider" -Target (Get-Location).Path
```

### Step 5: Configure OpenClaw

Add the plugin to your `~/.openclaw/openclaw.json`:

```json5
{
  messages: {
    tts: {
      provider: "mimo-tts-provider",
      mimoTts: {
        apiKey: "your-xiaomi-api-key",
        voice: "default_zh",
        style: "calm",
        format: "wav"
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

Send a message with `/say` in your OpenClaw channel (Telegram, Discord, etc.):

```
/say Hello, I can speak now!
```

The agent should respond with synthesized speech audio.

## Development

### Project Structure

```
mimo-tts-provider/
├── index.ts              # Plugin entry point — registers speech provider and tools
├── config.ts             # Config resolution (API key, voice, style, format)
├── mimo-api.ts           # HTTP client for MiMo API
├── package.json          # npm package metadata and OpenClaw plugin manifest
├── openclaw.plugin.json  # OpenClaw plugin discovery manifest
└── .gitignore
```

### Key Files

- **`index.ts`** — Main entry. Registers the `mimo-tts-provider` speech provider and the `mimo_tts_say` agent tool. Handles style merging, user context extraction, and voice validation.
- **`config.ts`** — Resolves configuration from three sources in priority order: plugin config → global config → environment variable. Logs config source for debugging.
- **`mimo-api.ts`** — HTTP client. Sends POST requests to MiMo's `/v1/chat/completions` endpoint with timeout support and error handling.

### Logging

The plugin logs with the `[mimo-tts]` prefix. Key log events:

- Config resolution (API key masked, source traced)
- Voice validation and fallback
- Style merging
- User context extraction
- API request details (endpoint, timeout)
- API response timing
- Audio buffer size

## License

MIT

## Credits

Built for [OpenClaw](https://github.com/openclaw/openclaw) using the OpenClaw Plugin SDK.
