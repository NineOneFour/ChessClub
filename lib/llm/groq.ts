import Groq from "groq-sdk";

/**
 * The one place that knows how to talk to Groq. `lib/llm/coach.ts` builds
 * what to say; this module only sends it. A second provider later is a
 * second module with the same three exports, swapped in at the one call
 * site in `lib/llm/coach.ts` — there is no registry to extend because there
 * is nothing to register yet.
 */

// llama-3.3-70b-versatile (the original plan's choice) was decommissioned by Groq;
// this is the closest available analog — Groq's largest current general-purpose model.
const DEFAULT_MODEL = "openai/gpt-oss-120b";

let cachedClient: Groq | null = null;

/** Whether coaching can run at all. Checked once at worker startup. */
export function isConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

/** The model to use — GROQ_MODEL if set, else the default. */
export function model(): string {
  return process.env.GROQ_MODEL || DEFAULT_MODEL;
}

function getClient(): Groq {
  if (!cachedClient) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY is not set");
    cachedClient = new Groq({ apiKey });
  }
  return cachedClient;
}

/** One system/user exchange, no streaming, no tools. Returns the reply text. */
export async function complete(systemPrompt: string, userPrompt: string): Promise<string> {
  const response = await getClient().chat.completions.create({
    model: model(),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content || content.trim().length === 0) {
    throw new Error("Groq returned an empty response");
  }
  return content.trim();
}
