/**
 * MiMo API client — handles HTTP requests to the MiMo chat completions endpoint.
 * Kept separate from credential resolution.
 */

const LOG_PREFIX = "[mimo-tts]";

export async function callMimoApi(
  apiBase: string,
  apiKey: string,
  payload: object,
  timeoutMs: number
): Promise<any> {
  const url = `${apiBase}/chat/completions`;
  const startTime = Date.now();

  console.log(
    `${LOG_PREFIX} API request → POST ${url} (timeout: ${timeoutMs}ms)`
  );

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err: unknown) {
    const elapsed = Date.now() - startTime;

    if (err instanceof DOMException && err.name === "TimeoutError") {
      console.error(
        `${LOG_PREFIX} API request timed out after ${elapsed}ms (limit: ${timeoutMs}ms)`
      );
      throw new Error(
        `MiMo TTS API request timed out after ${timeoutMs}ms`
      );
    }

    if (err instanceof TypeError && (err.message.includes("fetch") || err.message.includes("network"))) {
      console.error(
        `${LOG_PREFIX} Network error after ${elapsed}ms — cannot reach ${url}: ${err.message}`
      );
      throw new Error(
        `MiMo TTS network error: cannot reach ${apiBase} — ${err.message}`
      );
    }

    console.error(
      `${LOG_PREFIX} API request failed after ${elapsed}ms:`,
      err
    );
    throw err;
  }

  const elapsed = Date.now() - startTime;

  if (!resp.ok) {
    const body = await resp.text().catch(() => "(failed to read response body)");
    console.error(
      `${LOG_PREFIX} API error ${resp.status} after ${elapsed}ms — ${body.slice(0, 500)}`
    );
    throw new Error(`MiMo TTS API error ${resp.status}: ${body}`);
  }

  let result: any;
  try {
    result = await resp.json();
  } catch (err) {
    console.error(
      `${LOG_PREFIX} Failed to parse API response as JSON after ${elapsed}ms:`,
      err
    );
    throw new Error("MiMo TTS API returned invalid JSON");
  }

  console.log(
    `${LOG_PREFIX} API response ← ${resp.status} (${elapsed}ms)`
  );

  return result;
}
