# OpenClaw MiMo TTS Provider

一个基于 TypeScript 的原生语音合成插件，为 [OpenClaw](https://github.com/openclaw/openclaw) 集成小米 MiMo V2 TTS 接口。

## 解决了什么问题

OpenClaw 内置的 TTS 提供商（OpenAI、ElevenLabs 等）需要付费 API Key，且不支持小米 MiMo V2 语音合成模型。MiMo V2 提供高质量的中英文语音合成，并通过 `<style>` 标签支持精细的韵律控制——这是小米 API 独有的功能，其他提供商没有提供。本插件填补了这个空白，让 MiMo V2 成为 OpenClaw 中的一级语音提供商。

## 实现原理

插件基于 **OpenClaw Plugin SDK**（`openclaw/plugin-sdk/*`）构建，注册两个功能：

1. **语音提供商**（`mimo-tts-provider`）—— 通过小米的 Chat Completions API 处理文字转语音。MiMo V2 使用非标准 TTS 接口：它不是用专用的 `/audio/speech` 端点，而是通过 `/v1/chat/completions` 端点接受 TTS 请求，需要传入 `messages` 数组和 `audio` 配置对象。

2. **Agent 工具**（`mimo_tts_say`）—— 当用户发送 `/say` 命令时，LLM Agent 可以调用此工具。Agent 会先组织回答内容，将原始问题作为 `<user>...</user>` 上下文附加在末尾，然后调用此工具进行语音合成和播放。

### 架构流程

```
用户发送 /say 命令
        │
        ▼
   LLM Agent 组织回答
        │
        ▼
   调用 mimo_tts_say 工具
        │
        ▼
   OpenClaw TTS 运行时路由到 mimo-tts-provider
        │
        ▼
   调用 synthesize()
   ├── resolveConfig() — 读取 API key、voice、style、format
   ├── prependStyle() — 合并 style 标签
   ├── 从文本中提取 <user> 上下文
   └── callMimoApi() — POST 到 /v1/chat/completions
        │
        ▼
   MiMo 在响应 JSON 中返回 base64 编码的音频
        │
        ▼
   音频 buffer 返回给 OpenClaw 进行播放
```

### 样式标签系统

MiMo V2 支持在文本输入中使用内联 `<style>...</style>` 标签控制韵律（情感、节奏、强调）。插件会将配置中的默认样式与 LLM 直接写入的样式标签合并：

| 场景 | 输入 | 发送到 API |
|------|------|------------|
| 只有配置样式 | `Hello world` | `<style>calm</style>Hello world` |
| LLM 样式 + 配置样式 | `<style>happy</style>Great news!` | `<style>happy calm</style>Great news!` |
| 只有 LLM 样式（无配置） | `<style>sad</style>Oh no...` | `<style>sad</style>Oh no...` |
| 重复 token | `<style>calm gentle</style>...` + 配置 `calm` | `<style>calm gentle</style>...` |

### 用户上下文提取

当 Agent 在文本末尾附加 `<user>原始问题</user>` 时，插件会提取它，并将其作为单独的 `user` 消息放入 API 请求。这给了 MiMo 对话上下文，让语调更自然：

```json
{
  "messages": [
    { "role": "user", "content": "法国的首都是哪里？" },
    { "role": "assistant", "content": "<style>cheerful</style>法国的首都是巴黎！" }
  ],
  "audio": { "format": "wav", "voice": "default_zh" }
}
```

## 参数说明

### 配置参数（`openclaw.json`）

以下配置项放在 OpenClaw 配置文件的 `messages.tts.providers.mimo-tts-provider` 下：

| 参数 | 类型 | 默认值 | 必填 | 说明 |
|------|------|--------|------|------|
| `apiKey` | `string` | — | **是** | 小米 MiMo API Key。也可通过 `XIAOMI_API_KEY` 环境变量设置。两者都存在时，配置值优先。 |
| `apiBase` | `string` | `https://api.xiaomimimo.com/v1` | 否 | MiMo API 基础 URL。插件会在此基础上追加 `/chat/completions`。使用代理或自定义端点时可覆盖。 |
| `voice` | `string` | `default_zh` | 否 | 默认语音 ID。有效值：`mimo_default`、`default_zh`、`default_en`。无效值会回退到 `default_zh`。 |
| `style` | `string` | `""`（空） | 否 | 默认样式 token，会在每次合成请求前附加。写成 `<style>{value}</style>` 格式。示例：`calm`、`cheerful gentle`、`sad slow`。 |
| `format` | `string` | `wav` | 否 | 音频输出格式。直接传给 MiMo API。常用值：`wav`、`mp3`。 |

### 配置示例

```json5
{
  messages: {
    tts: {
      provider: "mimo-tts-provider",
      mimoTts: {
        apiKey: "你的小米-api-key",
        apiBase: "https://api.xiaomimimo.com/v1",
        voice: "default_zh",
        style: "calm",
        format: "wav"
      }
    }
  }
}
```

### 环境变量（备选方式）

不想把 API Key 写进配置文件的话，可以设置环境变量：

```bash
export XIAOMI_API_KEY=你的小米-api-key
```

插件会优先检查配置文件，找不到再去环境变量中查找。

### Agent 工具：`mimo_tts_say`

注册后，Agent 可以调用此工具合成语音。该工具只有一个参数：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `text` | `string` | **是** | 要朗读的回答文本。可以包含 `<style>...</style>` 前缀控制韵律。必须在末尾用 `<user>...</user>` 附带原始用户问题作为上下文。 |

**格式：** `[<style>tokens</style>]回答文本<user>原始问题</user>`

**示例：**
```
<style>cheerful</style>好问题！法国的首都是巴黎。<user>法国的首都是哪里？</user>
```

### 支持的样式 Token

MiMo V2 支持任意格式的样式 token。常用样式包括：

| Token | 效果 |
|-------|------|
| `calm` | 放松、平稳的节奏 |
| `cheerful` | 积极向上、愉快的语调 |
| `sad` | 沉重、较慢的节奏 |
| `gentle` | 柔和、温暖的表达 |
| `excited` | 充满能量、较快的节奏 |
| `serious` | 正式、克制的表达 |
| `whisper` | 安静、私密的语气 |
| `singing` | 音乐般、旋律化的表达 |

多个 token 可以组合：`<style>calm gentle</style>`

### 支持的语音

| 语音 ID | 说明 |
|---------|------|
| `mimo_default` | MiMo 默认语音 |
| `default_zh` | 中文优化语音（默认） |
| `default_en` | 英文优化语音 |

## 克隆后配置步骤

### 环境要求

- 已安装并运行 [OpenClaw](https://github.com/openclaw/openclaw)（v2026.3.24-beta.2 或更高版本）
- Node.js >= 22
- 小米 MiMo API Key（在 [platform.xiaomimimo.com](https://platform.xiaomimimo.com) 申请）

### 第一步：克隆仓库

```bash
git clone https://github.com/liciheng1998/openclaw-mimo-tts.git
cd openclaw-mimo-tts
```

### 第二步：安装依赖

```bash
npm install
```

### 第三步：编译插件

插件使用 TypeScript 编写，需要编译：

```bash
npx tsc
```

编译产物（`.js` 和 `.d.ts` 文件）会输出到 `dist/` 目录。

### 第四步：安装到 OpenClaw

将插件目录复制或软链接到 OpenClaw 的插件目录：

```bash
# 方式 A：复制
cp -r . ~/.openclaw/plugins/mimo-tts-provider

# 方式 B：软链接（适合开发——修改后重新编译即可生效）
ln -s $(pwd) ~/.openclaw/plugins/mimo-tts-provider
```

Windows（PowerShell）下：
```powershell
# 复制
Copy-Item -Recurse . $env:USERPROFILE\.openclaw\plugins\mimo-tts-provider

# 软链接（需要管理员权限）
New-Item -ItemType SymbolicLink -Path "$env:USERPROFILE\.openclaw\plugins\mimo-tts-provider" -Target (Get-Location).Path
```

### 第五步：配置 OpenClaw

在 `~/.openclaw/openclaw.json` 中添加插件配置：

```json5
{
  messages: {
    tts: {
      provider: "mimo-tts-provider",
      mimoTts: {
        apiKey: "你的小米-api-key",
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

或者通过环境变量设置 API Key：

```bash
export XIAOMI_API_KEY=你的小米-api-key
```

### 第六步：重启 OpenClaw Gateway

```bash
openclaw gateway restart
```

### 第七步：测试

在 OpenClaw 频道（Telegram、Discord 等）中发送 `/say` 命令：

```
/say 你好，我现在可以说话了！
```

Agent 应该会回复合成后的语音音频。

## 项目结构

```
mimo-tts-provider/
├── index.ts              # 插件入口 — 注册语音提供商和 Agent 工具
├── config.ts             # 配置解析（API key、voice、style、format）
├── mimo-api.ts           # MiMo API HTTP 客户端
├── package.json          # npm 包元数据和 OpenClaw 插件清单
├── openclaw.plugin.json  # OpenClaw 插件发现清单
└── .gitignore
```

### 核心文件说明

- **`index.ts`** — 主入口。注册 `mimo-tts-provider` 语音提供商和 `mimo_tts_say` Agent 工具。处理样式合并、用户上下文提取和语音验证。
- **`config.ts`** — 配置解析。优先级：插件配置 > 全局配置 > 环境变量。日志中会标注配置来源方便调试。
- **`mimo-api.ts`** — HTTP 客户端。向 MiMo 的 `/v1/chat/completions` 端点发送 POST 请求，支持超时和错误处理。

### 日志说明

插件日志以 `[mimo-tts]` 为前缀。关键日志事件包括：

- 配置解析（API Key 会被遮蔽，显示来源）
- 语音验证和回退
- 样式合并
- 用户上下文提取
- API 请求详情（端点、超时时间）
- API 响应耗时
- 音频 buffer 大小

## 开源许可

MIT License
