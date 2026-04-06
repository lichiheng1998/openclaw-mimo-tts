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
import type { SpeechSynthesisRequest } from "openclaw/plugin-sdk/speech-core";
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

async function synthesize(req: SpeechSynthesisRequest): Promise<{ audioBuffer: Buffer; outputFormat: string; fileExtension: string; voiceCompatible: boolean }> {
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

  // Strip newlines and backslashes the model sometimes emits
  finalText = finalText.replace(/\n/g, "").replace(/\\/g, "");
  if (userContext) {
    userContext = userContext.replace(/\n/g, "").replace(/\\/g, "");
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
      isConfigured: ({ cfg, providerConfig }) =>
        Boolean(
          (providerConfig as any)?.apiKey ??
          (cfg?.messages?.tts?.providers?.["mimo-tts-provider"] as any)?.apiKey ??
          process.env["XIAOMI_API_KEY"]
        ),
      synthesize,
    });

    console.log(`${LOG_PREFIX} Plugin registered successfully`);
  },
});
