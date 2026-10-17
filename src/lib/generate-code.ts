import "server-only";
import OpenAI from "openai";
import { buildVideoPrompt } from "./video-prompt";
import { buildVideoInput, extractModule } from "./video-module";
import type { GenerateCode } from "./video-jobs";

export const CODE_MODEL = "gpt-6-astra";

let client: OpenAI | null = null;
function openai(): OpenAI {
  // Reads OPENAI_API_KEY from the server environment. This module is server-only.
  client ??= new OpenAI();
  return client;
}

/** One model call that writes the video module (or fixes the previous one). */
export const generateCode: GenerateCode = async ({ prompt, format, vibe, fix }, { signal }) => {
  const response = await openai().responses.create(
    {
      model: CODE_MODEL,
      instructions: buildVideoPrompt({ format, vibe }),
      input: buildVideoInput(prompt, fix),
      max_output_tokens: 16000,
      store: false,
    },
    // No SDK retries: a ~2.5 min call retried would blow the 5 min limit and double the cost.
    { signal, maxRetries: 0 },
  );
  const usage = {
    input_tokens: response.usage?.input_tokens ?? 0,
    output_tokens: response.usage?.output_tokens ?? 0,
  };
  const code = response.status === "completed" ? extractModule(response.output_text) : null;
  return { code, usage };
};
