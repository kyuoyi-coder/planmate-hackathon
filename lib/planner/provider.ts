import "server-only";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dateOf } from "@/lib/time";
import { resolveUserDates } from "./dates";
import { mockPlanner } from "./mock";
import { buildCompactMessage, buildRuntimeContext, buildSystemPrompt } from "./prompt";
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

const PROVIDERS = ["mock", "openai-compatible", "agent-chat"] as const;
type Provider = (typeof PROVIDERS)[number];

/**
 * The configured provider. Only an unset LLM_PROVIDER means the built-in
 * mock; a typo is an error rather than a silent switch to canned replies.
 */
export function providerName(): Provider {
  const value = process.env.LLM_PROVIDER?.trim() || "mock";
  if ((PROVIDERS as readonly string[]).includes(value)) return value as Provider;
  throw new ModelError(
    `LLM_PROVIDER="${value}" is not supported. Use one of: ${PROVIDERS.join(", ")}.`,
  );
}

/** Runs one planning turn against whichever model is configured in the env. */
export async function runPlanner(
  history: ChatTurn[],
  context: PlannerContext,
): Promise<ModelOutput> {
  const provider = providerName();
  if (provider === "mock") return mockPlanner(history, context);

  const lastUser = history.findLast((turn) => turn.role === "user")?.content ?? "";
  context = { ...context, userDates: resolveUserDates(lastUser, dateOf(context.now)) };
  if (provider === "agent-chat") return callAgentChat(history, context);

  const text = await callOpenAiCompatible(history, context);
  return parseModelOutput(text);
}

const fileCache = new Map<string, string | null>();
function readOnce(...path: string[]) {
  const key = path.join("/");
  if (!fileCache.has(key)) {
    try {
      fileCache.set(key, readFileSync(join(process.cwd(), ...path), "utf8"));
    } catch {
      fileCache.set(key, null);
    }
  }
  return fileCache.get(key) ?? null;
}

/**
 * The system prompt for routes that take one (openai-compatible, and
 * agent-chat with LLM_AGENT_PROMPT=system).
 *
 * Default ("compact"): docs/model/PLANMATE_SYSTEM_PROMPT.md, the same file
 * the model server can load, so there is one source of instructions, plus
 * the runtime context. About 3k tokens, sized for small models such as
 * Qwen2.5-1.5B. LLM_PROMPT=full uses the longer, example-free contract.
 *
 * LLM_SEND_POLICY=on puts the model's general policy (lib/planner/policy.md,
 * about 8k tokens) in front. Leave it off for small models: it is longer
 * than everything else together, and servers with a short context window
 * cut the start of the prompt, which is where the instructions are.
 */
/** The instruction file alone (plus the policy when switched on), no context. */
function staticPrompt() {
  const compact = readOnce("docs", "model", "PLANMATE_SYSTEM_PROMPT.md");
  if (!compact) return null;
  const policy = process.env.LLM_SEND_POLICY === "on" ? readOnce("lib", "planner", "policy.md") : null;
  return policy ? `${policy}

---

${compact}` : compact;
}

function systemPrompt(context: PlannerContext) {
  const compact = readOnce("docs", "model", "PLANMATE_SYSTEM_PROMPT.md");
  const contract =
    process.env.LLM_PROMPT === "full" || !compact
      ? buildSystemPrompt(context)
      : `${compact.trim()}

${buildRuntimeContext(context)}`;
  const policy = process.env.LLM_SEND_POLICY === "on" ? readOnce("lib", "planner", "policy.md") : null;
  return policy
    ? `${policy}

---

# Structured-action contract and runtime context (supplied by the PlanMate application)
Where this differs from the policy above, this section describes the real app and wins.

${contract}`
    : contract;
}

const baseUrlOf = () => {
  const baseUrl = process.env.LLM_BASE_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl) throw new ModelError("LLM_BASE_URL must be set for the planning model.");
  return baseUrl;
};

const authHeader = (): Record<string, string> =>
  process.env.LLM_API_KEY ? { Authorization: `Bearer ${process.env.LLM_API_KEY}` } : {};

const timeout = () => AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS) || 120_000);

/**
 * An agent server with a single `POST /chat {message, thread_id}` endpoint
 * (for example a FastAPI wrapper around a local Qwen). It has no system
 * prompt and caps the message size, so the whole contract, the user's
 * situation and the conversation go into one message, and every turn uses a
 * fresh thread so the server's own memory never mixes with ours.
 *
 * The answer is used as the model gave it: JSON in `reply` becomes an
 * action, a tool call named after an action is used the same way, and any
 * other text is shown to the user as the model's chat reply.
 */
async function callAgentChat(
  history: ChatTurn[],
  context: PlannerContext,
): Promise<ModelOutput> {
  const baseUrl = baseUrlOf();
  const path = process.env.LLM_CHAT_PATH?.trim() || "/chat";
  const maxChars = Number(process.env.LLM_MAX_MESSAGE_CHARS) || 8000;
  // Where the instructions live (see docs/model/SERVER_SETUP.md):
  // "inline"  - the server can't take any: squeeze the contract into the message;
  // "server"  - the server loads docs/model/PLANMATE_SYSTEM_PROMPT.md itself;
  // "system"  - the server accepts a `system` field: send the full policy and
  //             contract there (no size cap), and only the context in `message`.
  const mode = process.env.LLM_AGENT_PROMPT?.trim() || "inline";
  const message = buildCompactMessage(context, history, maxChars, mode === "inline");

  // The message already carries the runtime context, so the `system` field
  // only needs the instructions themselves.
  const system = mode === "system" ? staticPrompt() ?? systemPrompt(context) : undefined;
  const first = await postAgent(baseUrl, path, message, system);
  if (first.kind === "output") return first.output;

  // Small models often pick the right action but leave out the field that
  // carries it ("assign" with no "assignments"). Hand the answer back once
  // with the exact problem, as a tool would return a validation error.
  const problem =
    process.env.LLM_REPAIR === "off"
      ? null
      : (contractProblem(first.text) ?? askedForGivenDates(first.text, context));
  if (problem) {
    const retry = `${message}

Your answer was:
${first.text}

That answer is not usable: ${problem}
Answer again with the complete, corrected JSON object only.`;
    const second = await postAgent(baseUrl, path, retry, system).catch(() => null);
    if (second?.kind === "text" && !contractProblem(second.text) && !askedForGivenDates(second.text, context)) {
      return parseModelOutput(second.text);
    }
    console.warn("[planner] the model's answer was still incomplete after one retry:", problem);
  }
  return parseModelOutput(first.text);
}

/** One request to the agent server: an action from a tool call, or reply text. */
async function postAgent(
  baseUrl: string,
  path: string,
  message: string,
  system: string | undefined,
): Promise<{ kind: "output"; output: ModelOutput } | { kind: "text"; text: string }> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({
        message,
        thread_id: `planmate-${randomUUID()}`,
        ...(system ? { system } : {}),
      }),
      signal: timeout(),
    });
  } catch (error) {
    throw new ModelError(
      `Could not reach the planning model at ${baseUrl} (${error instanceof Error ? error.message : "network error"}).`,
    );
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new ModelError(`The planning model returned HTTP ${response.status}. ${detail}`);
  }

  const data = (await response.json().catch(() => null)) as {
    reply?: unknown;
    blocked?: unknown;
    tool_calls?: unknown;
  } | null;
  if (!data) throw new ModelError("The planning model did not return JSON.");

  const fromTool = actionFromToolCalls(data.tool_calls);
  if (fromTool) return { kind: "output", output: fromTool };

  const reply = typeof data.reply === "string" ? data.reply.trim() : "";
  if (!reply) throw new ModelError("The planning model returned an empty reply.");
  if (data.blocked === true) {
    // The server's own safety check stopped the answer; show what it said.
    console.warn("[planner] the model server blocked this turn:", reply);
    return { kind: "output", output: { action: "chat", reply } };
  }
  return { kind: "text", text: reply };
}

const REQUIRED_FIELD = {
  propose: {
    field: "plan",
    schema: planIntentSchema,
    shape: '"revise": false, "plan": {"items": [{"title": "...", "category": "study", "priority": "medium", "dueDate": "YYYY-MM-DD", "steps": [{"title": "...", "hours": 1.5}]}]}',
  },
  update: {
    field: "taskUpdates",
    schema: taskUpdatesSchema,
    shape: '"taskUpdates": [{"task": "T1", "status": "completed"}]',
  },
  remove: {
    field: "removals",
    schema: removalsSchema,
    shape: '"removals": [{"task": "T1"}] or [{"session": "S1"}]',
  },
  assign: {
    field: "assignments",
    schema: assignmentsSchema,
    shape: '"assignments": [{"assignee": "M1", "title": "...", "priority": "medium", "dueDate": "YYYY-MM-DD"}]',
  },
  email: {
    field: "email",
    schema: emailRequestSchema,
    shape: '"email": {"task": "T1", "reason": "..."}',
  },
} as const;

/**
 * The model asked for a deadline or period the user already gave ("this
 * week", "by Friday"), which small models do a lot. Returns the correction
 * to send back, or null.
 */
function askedForGivenDates(text: string, context: PlannerContext): string | null {
  if (!context.userDates?.length) return null;
  const parsed = parseModelOutput(text);
  if (parsed.action !== "ask" && !(parsed.action === "propose" && !("plan" in parsed))) return null;
  if (!/deadline|due|when|date|by what|timeline|time ?frame|which day|how long/i.test(parsed.reply)) return null;
  return `you asked about timing, but the user already gave it: ${context.userDates.join(" ")} Do not ask. Make reasonable assumptions, mention them in "reply", and answer with "propose" and the complete plan.`;
}

/**
 * What is wrong with a JSON answer that names an action but lacks the field
 * that action needs, in words the model can act on; null when it is usable,
 * or when it is plain text (shown as a chat reply).
 */
export function contractProblem(text: string): string | null {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return "it is not valid JSON. Return exactly one JSON object.";
  }
  const parsed = modelOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const rule = REQUIRED_FIELD[parsed.data.action as keyof typeof REQUIRED_FIELD];
  if (!rule) return null;
  const value = (raw as Record<string, unknown>)[rule.field];
  if (rule.schema.safeParse(value).success) return null;
  return value === undefined
    ? `action "${parsed.data.action}" needs the "${rule.field}" field, and it is missing. Use the details the user already gave. Shape: ${rule.shape}`
    : `the "${rule.field}" field does not match the required shape: ${rule.shape}`;
}

/** A tool call named after one of PlanMate's actions, if the agent made one. */
function actionFromToolCalls(calls: unknown): ModelOutput | null {
  if (!Array.isArray(calls)) return null;
  for (const call of calls) {
    if (!call || typeof call !== "object") continue;
    const record = call as Record<string, unknown>;
    const fn = (record.function ?? record) as Record<string, unknown>;
    const name = String(fn.name ?? record.tool ?? "");
    let args = fn.arguments ?? fn.args ?? record.input ?? record.args;
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        continue;
      }
    }
    if (!args || typeof args !== "object") continue;
    const candidate = { action: name.replace(/^planmate[_.-]?/i, ""), ...(args as object) };
    if (!modelOutputSchema.safeParse(candidate).success) continue;
    return parseModelOutput(JSON.stringify(candidate));
  }
  return null;
}

async function callOpenAiCompatible(
  history: ChatTurn[],
  context: PlannerContext,
) {
  const baseUrl = baseUrlOf();
  const model = process.env.LLM_MODEL;
  if (!model) {
    throw new ModelError("LLM_MODEL must be set when LLM_PROVIDER=openai-compatible.");
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader(),
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt(context) },
          ...history,
        ],
        temperature: 0.3,
        stream: false,
        // Set LLM_JSON_MODE=off if the server rejects response_format.
        ...(process.env.LLM_JSON_MODE === "off"
          ? {}
          : { response_format: { type: "json_object" } }),
      }),
      signal: timeout(),
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
