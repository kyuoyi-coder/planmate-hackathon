import "server-only";
import { mockPlanner } from "./mock";
import { buildSystemPrompt } from "./prompt";
import {
  assignmentsSchema,
  emailRequestSchema,
  modelOutputSchema,
  planIntentSchema,
  removalsSchema,
  taskUpdatesSchema,
  type ChatTurn,
  type ModelOutput,
  type PlannerContext,
} from "./types";

export class ModelError extends Error {}

export const providerName = () =>
  process.env.LLM_PROVIDER === "openai-compatible"
    ? "openai-compatible"
    : "mock";

/** Runs one planning turn against whichever model is configured in the env. */
export async function runPlanner(
  history: ChatTurn[],
  context: PlannerContext,
): Promise<ModelOutput> {
  if (providerName() === "mock") return mockPlanner(history, context);

  const text = await callOpenAiCompatible(history, context);
  return parseModelOutput(text);
}

async function callOpenAiCompatible(
  history: ChatTurn[],
  context: PlannerContext,
) {
  const baseUrl = process.env.LLM_BASE_URL?.replace(/\/+$/, "");
  const model = process.env.LLM_MODEL;
  if (!baseUrl || !model) {
    throw new ModelError(
      "LLM_BASE_URL and LLM_MODEL must be set when LLM_PROVIDER=openai-compatible.",
    );
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.LLM_API_KEY
          ? { Authorization: `Bearer ${process.env.LLM_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: buildSystemPrompt(context) },
          ...history,
        ],
        temperature: 0.3,
        stream: false,
        // Set LLM_JSON_MODE=off if the server rejects response_format.
        ...(process.env.LLM_JSON_MODE === "off"
          ? {}
          : { response_format: { type: "json_object" } }),
      }),
      signal: AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS) || 120_000),
    });
  } catch (error) {
    throw new ModelError(
      `Could not reach the planning model at ${baseUrl} (${error instanceof Error ? error.message : "network error"}).`,
    );
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new ModelError(
      `The planning model returned HTTP ${response.status}. ${detail}`,
    );
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new ModelError("The planning model returned an empty response.");
  }
  return content;
}

/**
 * Parses the model's text into a ModelOutput. Tolerates reasoning tags,
 * markdown fences and stray prose around the JSON; if no usable JSON is
 * found, the text is shown to the user as an ordinary chat reply.
 */
export function parseModelOutput(text: string): ModelOutput {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  let raw: unknown;
  if (start !== -1 && end > start) {
    try {
      raw = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      raw = undefined;
    }
  }

  const parsed = modelOutputSchema.safeParse(raw);
  if (!parsed.success) return { action: "chat", reply: cleaned };

  const { action, reply } = parsed.data;
  if (action === "update") {
    const updates = taskUpdatesSchema.safeParse(parsed.data.taskUpdates);
    return updates.success
      ? { action, reply, taskUpdates: updates.data }
      : { action: "ask", reply: "Which task should I update, and to what status?" };
  }
  if (action === "remove") {
    const removals = removalsSchema.safeParse(parsed.data.removals);
    return removals.success
      ? { action, reply, removals: removals.data }
      : { action: "ask", reply: "Which task should I remove?" };
  }
  if (action === "assign") {
    const assignments = assignmentsSchema.safeParse(parsed.data.assignments);
    return assignments.success
      ? { action, reply, assignments: assignments.data }
      : { action: "ask", reply: "Who should I assign it to, and what is the task?" };
  }
  if (action === "email") {
    const email = emailRequestSchema.safeParse(parsed.data.email);
    return email.success
      ? { action, reply, email: email.data }
      : { action: "ask", reply: "Which task can't you finish on time, and why? I'll draft a message to whoever assigned it." };
  }
  if (action !== "propose") return { action, reply };

  const plan = planIntentSchema.safeParse(parsed.data.plan);
  if (!plan.success) {
    return {
      action: "ask",
      reply:
        reply ||
        "I couldn't turn that into a plan. Could you tell me again what you need to get done, and by when?",
    };
  }
  return { action, reply, plan: plan.data, revise: parsed.data.revise === true };
}
