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
        "Example: `<style>calm</style>The answer is 42.<user>What is the meaning of life?</user>` " +
        "The <user> tag must come last, after all answer content.",
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
