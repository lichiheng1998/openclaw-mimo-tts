/**
 * MiMo TTS Provider Plugin for OpenClaw
 *
 * Registers Xiaomi MiMo V2 TTS as a native OpenClaw speech provider.
 * Supports voice, style, speed control, and context-aware synthesis.
 *
 * Config (in openclaw.json messages.tts):
 *   provider: "mimo-tts-provider"
 *   mimoTts:
 *     apiKey: "your-key"         (or set XIAOMI_API_KEY env var)
 *     apiBase: "https://api.xiaomimimo.com/v1"  (optional override)
 *     voice: "default_zh"        (default voice)
 *     format: "wav"              (audio format)
 *
 * Tools:
 *   /say <question>   — agent answers the question and speaks the response via TTS
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type {
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
} from "openclaw/plugin-sdk/speech-core";
import { Type } from "@sinclair/typebox";
import { resolveConfig } from "./config.js";
import { callMimoApi } from "./mimo-api.js";

const LOG_PREFIX = "[mimo-tts]";

// ─── Expressive TTS guide (embedded in tool description) ──────────────────────
const EXPRESSIVE_TTS_GUIDE = `
## Expressive MiMo TTS — Style & Markup Guide

Compose natural, expressive speech text. MiMo V2 infers tone from text context automatically —
add tags only when they meaningfully enhance the output.

### Style Tag — <style>...
Place at the very beginning. Free-form natural language.

Examples:
  <style>开心</style>      — cheerful, upbeat
  <style>温柔</style>      — soft, warm
  <style>伤心</style>      — sad, heavy
  <style>林黛玉</style>    — fragile, melancholy character voice
  <style>东北话</style>    — northeastern dialect
  <style>悄悄话</style>    — whispering
  <style>唱歌</style>      — singing (use ALONE, no other tags)
  <style>开心 温柔</style> — multiple styles combined (space-separated)
  <style>sad, speaking slowly</style> — English free-form also works

More known values: 悲伤, 生气, 惊讶, 害羞, 感动, 委屈, 紧张, 慵懒, 元气,
孙悟空, 唐僧, 夹子音, 台湾腔, 撒娇, 霸道, 四川话, 河南话, 粤语, 上海话,
机器人, 新闻播报, 朗诵, 说唱, 变快, 变慢

### Audio Tags (inline)
Insert inside the text. Chinese（）or English [] both work.

  （停顿）/（沉默片刻）/（深呼吸）/（叹气）/（长叹一口气）
  （笑）/（轻笑）/（苦笑）/（哽咽）/（咳嗽）/（剧烈咳嗽）
  （提高音量喊话）/（压低声音）/（小声）
  （语速加快）/（碎碎念）/（紧张，深呼吸）
  （虚弱，气若游丝）/（极其疲惫，有气无力）/（突然激动起来）
  [pause] / [laugh] / [sigh] / [whisper] / [shout] / [nervous, deep breath]

Combine freely: （虚弱，气若游丝）, [nervous sigh], （突然激动起来）

### Typography as Prosody
  ALL CAPS → stress emphasis
  UN-BE-LIEV-ABLE → syllable-by-syllable
  不不不不不 / sooooo → rhythm & intensity
  …… → trailing off, hesitation
  ！！！ → heightened exclamation
  ？？？ → exasperated disbelief
  —— → elongation, dramatic pause

### <user> Tag (MANDATORY)
Append <user>original user words</user> at the very end — MiMo uses it for conversational context.

### Assembly Format
[<style>styles</style>] answer text with (audio tags) and typography <user>user's question</user>

### Full Examples

1. No style needed (MiMo infers from text):
  你怎么可以这样对我！我把你当成最信任的人！<user>骂人</user>

2. Style + audio tags:
  <style>温柔</style>（深呼吸）呼……你知道吗（停顿）我一直都在这里等你。<user>安慰我</user>

3. Character voice:
  <style>林黛玉</style>我就知道，别人不挑剩下的也不给我。早知他今日来，我就不来了。<user>用林黛玉语气说话</user>

4. Dialect:
  <style>东北话</style>哎呀妈呀，这外头风刮得，跟小刀刮脸似的！<user>说天气冷</user>

5. Singing:
  <style>唱歌</style>我怎么变这样，变得这样倔强？<user>唱一段歌</user>

6. English free-form:
  <style>deeply affectionate, speaking slowly</style>I've been thinking about you all day.<user>say something sweet</user>
`;

// ─── Valid MiMo voices ────────────────────────────────────────────────────────
const VALID_VOICES = new Set(["mimo_default", "default_zh", "default_en"]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Prepend a <style>...</style> tag to text.
 * - If text already starts with <style>, merge the new style into it.
 * - Otherwise, prepend a new tag.
 */
function prependStyle(text: string, style: string): string {
  if (!style) return text;
  const existing = text.match(/^<style>(.*?)<\/style>/s);
  if (existing) {
    // Merge and deduplicate: split by whitespace, keep unique tokens in order
    const tokens = `${existing[1]} ${style}`.trim().split(/\s+/);
    const unique = [...new Set(tokens)].join(" ");
    return `<style>${unique}</style>${text.slice(existing[0].length)}`;
  }
  return `<style>${style}</style>${text}`;
}

// ─── Synthesize ───────────────────────────────────────────────────────────────

async function synthesize(req: SpeechSynthesisRequest): Promise<SpeechSynthesisResult> {
  const { apiKey, apiBase, defaultVoice, defaultStyle, audioFormat } = resolveConfig(req);

  if (!apiKey) {
    const msg = "MiMo TTS: missing API key. Set XIAOMI_API_KEY or messages.tts.mimoTts.apiKey";
    console.error(`${LOG_PREFIX} ${msg}`);
    throw new Error(msg);
  }

  if (!req.text || !req.text.trim()) {
    console.warn(`${LOG_PREFIX} Received empty text, skipping synthesis`);
    throw new Error("MiMo TTS: cannot synthesize empty text");
  }

  console.log(`${LOG_PREFIX} Synthesize request — text length: ${req.text.length}, voice: ${defaultVoice}, format: ${audioFormat}`);

  // Voice: config default only. Must be a valid MiMo voice.
  const mimoVoice = VALID_VOICES.has(defaultVoice) ? defaultVoice : "default_zh";
  if (mimoVoice !== defaultVoice) {
    console.warn(
      `${LOG_PREFIX} Invalid voice "${defaultVoice}", falling back to "${mimoVoice}". Valid voices: ${[...VALID_VOICES].join(", ")}`
    );
  }

  // Style: config style is ALWAYS merged in.
  // - Text has no <style> tag  → prepend <style>{configStyle}</style>
  // - Text already has <style>X</style> → becomes <style>X {configStyle}</style>
  // Model controls style by writing <style>...</style> directly in text.
  let finalText = req.text;
  if (defaultStyle) {
    finalText = prependStyle(finalText, defaultStyle);
    console.log(`${LOG_PREFIX} Style merged: "${defaultStyle}"`);
  }

  // Extract <user>...</user> context tag if present
  // The model appends this to pass the user's last message as context
  let userContext: string | undefined;
  finalText = finalText.replace(/<user>([\s\S]*?)<\/user>\s*$/, (_, content) => {
    userContext = content.trim();
    return "";
  });
  if (userContext) {
    console.log(`${LOG_PREFIX} User context extracted (${userContext.length} chars)`);
  }

  // Build messages array
  const messages: Array<{ role: string; content: string }> = [];
  if (userContext) {
    messages.push({ role: "user", content: userContext });
  }
  messages.push({ role: "assistant", content: finalText });

  const payload = {
    model: "mimo-v2-tts",
    messages,
    audio: { format: audioFormat, voice: mimoVoice },
  };

  console.log(
    `${LOG_PREFIX} Sending to MiMo API:`,
    JSON.stringify({ messages, audio: payload.audio }, null, 2)
  );

  let result: any;
  try {
    result = await callMimoApi(apiBase, apiKey, payload, req.timeoutMs ?? 60_000);
  } catch (err) {
    console.error(`${LOG_PREFIX} API call failed:`, err);
    throw err;
  }

  const audioB64: string | undefined = result?.choices?.[0]?.message?.audio?.data;
  if (!audioB64) {
    const preview = JSON.stringify(result).slice(0, 200);
    console.error(`${LOG_PREFIX} Unexpected response shape: ${preview}`);
    throw new Error(`MiMo TTS: unexpected response shape — ${preview}`);
  }

  const audioBuffer = Buffer.from(audioB64, "base64");
  console.log(
    `${LOG_PREFIX} Synthesis complete — audio size: ${audioBuffer.length} bytes, format: ${audioFormat}`
  );

  return {
    audioBuffer,
    outputFormat: audioFormat,
    fileExtension: `.${audioFormat}`,
    voiceCompatible: true,
  };
}

// ─── Tools ────────────────────────────────────────────────────────────────────

/**
 * mimo_tts_say — triggered by /say
 * The agent answers the question in <question>, then calls this tool with the
 * answer text to synthesize and deliver speech.
 */
const SaySchema = Type.Object({
  text: Type.String({
    description:
      "The spoken answer text, optionally prefixed with <style>...</style> tags for prosody control, " +
      "and with the original user question appended as <user>...</user> at the very end. " +
      "Format: `[<style>tokens</style>]<answer><user>original question</user>` " +
      "Example: `<style>calm</style>The capital is Paris.<user>What is the capital of France?</user>`",
  }),
});

// ─── Plugin entry ─────────────────────────────────────────────────────────────

export default definePluginEntry({
  id: "mimo-tts-provider",
  name: "MiMo TTS Provider",
  description: "Xiaomi MiMo V2 TTS speech provider for OpenClaw",

  register(api) {
    console.log(`${LOG_PREFIX} Plugin registering...`);

    // Speech provider registration
    api.registerSpeechProvider({
      id: "mimo-tts-provider",
      label: "MiMo TTS",
      isConfigured: ({ config }: { config: any }) =>
        Boolean(
          config?.messages?.tts?.mimoTts?.apiKey ?? process.env["XIAOMI_API_KEY"]
        ),
      synthesize,
    });

    // /say — agent answers the question then calls this tool to speak the answer
    api.registerTool((ctx) => ({
      name: "mimo_tts_say",
      label: "MiMo TTS Say",
      description:
        "Synthesize speech for an answer you have composed for a /say request. " +
        "IMPORTANT: append the original user question at the end of `text` wrapped in " +
        "<user>...</user> tags so MiMo can use it as conversational context. " +
        "The <user> tag must come last, after all answer content.\n\n" +
        EXPRESSIVE_TTS_GUIDE,
      parameters: SaySchema,
      async execute(_toolCallId, params) {
        const cfg = ctx.runtimeConfig ?? api.config;
        console.log(`${LOG_PREFIX} [say] Synthesizing ${(params as any).text?.length ?? 0} chars`);
        const result = await api.runtime.tts.textToSpeech({
          text: (params as any).text,
          cfg,
          channel: ctx.messageChannel,
        });
        if (!result.success) {
          const err = (result as any).error ?? "TTS failed";
          console.error(`${LOG_PREFIX} [say] TTS error: ${err}`);
          return {
            content: [{ type: "text" as const, text: `TTS error: ${err}` }],
            details: { success: false, error: err },
          };
        }
        console.log(`${LOG_PREFIX} [say] Audio written to ${(result as any).audioPath}`);
        return {
          content: [
            {
              type: "text" as const,
              text: `Speech synthesized successfully. Audio: ${(result as any).audioPath}`,
            },
          ],
          details: result,
        };
      },
    }));

    console.log(`${LOG_PREFIX} Plugin registered successfully`);
  },
});
