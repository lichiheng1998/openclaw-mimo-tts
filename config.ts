/**
 * Config resolution — reads from plugin config and environment variables.
 * Kept separate from network layer to satisfy security scanner.
 */
import type { SpeechSynthesisRequest } from "openclaw/plugin-sdk/speech-core";

const LOG_PREFIX = "[mimo-tts]";

export interface MimoConfig {
  apiKey: string;
  apiBase: string;
  defaultVoice: string;
  defaultStyle: string;
  audioFormat: string;
}

export function resolveConfig(req: SpeechSynthesisRequest): MimoConfig {
  const cfg = req.cfg as any;
  // Config comes via providerConfig (from messages.tts.providers.mimo-tts-provider)
  const mimoConfig = (req.providerConfig as Record<string, any>) ?? {};

  // Track config source for debugging
  const providerCfg = cfg?.messages?.tts?.providers?.["mimo-tts-provider"];

  const apiKey =
    (mimoConfig.apiKey as string | undefined) ??
    (providerCfg?.apiKey as string | undefined) ??
    process.env["XIAOMI_API_KEY"] ??
    "";

  const apiBase =
    (mimoConfig.apiBase as string | undefined) ??
    (providerCfg?.apiBase as string | undefined) ??
    process.env["XIAOMI_API_BASE"] ??
    "https://api.xiaomimimo.com/v1";

  const defaultVoice =
    (mimoConfig.voice as string | undefined) ??
    (providerCfg?.voice as string | undefined) ??
    "default_zh";

  const defaultStyle =
    (mimoConfig.style as string | undefined) ??
    (providerCfg?.style as string | undefined) ??
    "";

  const audioFormat =
    (mimoConfig.format as string | undefined) ??
    (providerCfg?.format as string | undefined) ??
    "wav";

  // Log config resolution (mask API key)
  const maskedKey = apiKey ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : "(not set)";
  const keySource = mimoConfig.apiKey
    ? "providerConfig"
    : providerCfg?.apiKey
      ? "globalConfig"
      : process.env["XIAOMI_API_KEY"]
        ? "envVar"
        : "missing";

  console.log(
    `${LOG_PREFIX} Config resolved — apiBase: ${apiBase}, apiKey: ${maskedKey} (source: ${keySource}), voice: ${defaultVoice}, format: ${audioFormat}`
  );

  if (!apiKey) {
    console.warn(
      `${LOG_PREFIX} No API key found. Set XIAOMI_API_KEY env var or messages.tts.mimoTts.apiKey in config.`
    );
  }

  return { apiKey, apiBase, defaultVoice, defaultStyle, audioFormat };
}
