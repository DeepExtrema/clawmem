import type { LLM, LLMConfig, LLMMessage } from "../interfaces/index.js";

/**
 * OpenAI-compatible LLM adapter.
 * Works with any endpoint implementing the /v1/chat/completions API:
 *   - llama.cpp server
 *   - Ollama
 *   - LM Studio
 *   - OpenAI
 *   - DeepSeek, etc.
 */
export class OpenAICompatLLM implements LLM {
  private readonly baseURL: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly maxTokens: number;

  constructor(config: LLMConfig) {
    this.baseURL = config.baseURL.replace(/\/$/, "");
    this.apiKey = config.apiKey ?? "local";
    this.model = config.model ?? "gpt-4o-mini";
    this.temperature = config.temperature ?? 0.1;
    this.maxTokens = config.maxTokens ?? 4096;
  }

  async complete(
    messages: LLMMessage[],
    opts: { json?: boolean } = {},
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
    };

    if (opts.json) {
      body["response_format"] = { type: "json_object" };
    }

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LLM request failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const content = data.choices[0]?.message?.content;
    if (content === undefined || content === null) {
      throw new Error("LLM returned empty response");
    }
    return content;
  }
}
