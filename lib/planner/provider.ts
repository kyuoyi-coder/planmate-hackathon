import "server-only";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dateOf } from "@/lib/time";
import { resolveUserDates } from "./dates";
import { mockPlanner } from "./mock";
import { CANCEL_REQUEST, eventStepByStep, eventsNamedIn, KNOWN_EVENTS } from "./events";
import { CHANGE_REQUEST, revisePlanStepByStep } from "./revise";
import { planStepByStep, type Complete } from "./stepwise";
import { dueDateFrom, textOutsideCalls, toolCallsIn, toolSystemPrompt, toolUserMessage } from "./tools";
import { buildCompactMessage, buildRuntimeContext, buildSystemPrompt } from "./prompt";
import {
  assignmentsSchema,
  emailRequestSchema,
  eventsSchema,
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
  if (provider === "agent-chat") return withoutFalseClaims(await callAgentChat(history, context));

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
  // LLM_STEPWISE: "always" (default) builds plans step by step;
  // "fallback" only when the one-shot plan is missing; "off" never.
  const stepwise = process.env.LLM_STEPWISE?.trim() || "always";
  const lastUser = history.findLast((turn) => turn.role === "user")?.content ?? "";
  // Each small question is quick (~2 s); don't let one stuck request hold
  // the chat for the full model timeout.
  const stepTimeout = Number(process.env.LLM_STEP_TIMEOUT_MS) || 30_000;
  const complete = async (instructions: string, part: string) => {
    const answer =
      mode === "inline"
        ? await postAgent(baseUrl, path, `${instructions}

${part}`, undefined, stepTimeout)
        : await postAgent(baseUrl, path, part, instructions, stepTimeout);
    return answer.kind === "text" ? answer.text : "";
  };

  // A change to the current plan ("move the papers to next week, keep the
  // gym") would need the model to rewrite the whole plan, which a small model
  // can't; small questions about each phrase instead. Null when the message
  // names nothing in the plan, so it goes on to the normal path.
  // LLM_TOOLS=on: the model decides by calling one of PlanMate's tools in its
  // own tool-calling format; code then fills in the heavy parts.
  if (process.env.LLM_TOOLS === "on") {
    const toolMessage = toolUserMessage(context, history, maxChars);
    const answer =
      mode === "inline"
        ? await postAgent(baseUrl, path, `${toolSystemPrompt(context)}\n\n${toolMessage}`, undefined)
        : await postAgent(baseUrl, path, toolMessage, toolSystemPrompt(context));
    if (answer.kind === "output") return answer.output;
    return actOnToolCall(answer.text, complete, lastUser, context);
  }

  if (stepwise !== "off") {
    // "Cancel the weekly meeting": a fixed event named by its title.
    const namedEvents = context.events?.length && CANCEL_REQUEST.test(lastUser) ? eventsNamedIn(lastUser, context.events) : [];
    if (namedEvents.length) {
      return { action: "remove", reply: "", removals: namedEvents.map((event) => ({ event: event.ref })) };
    }
    // "I have a meeting every Friday at 2pm": a clock time and a day.
    const event = await eventStepByStep(complete, lastUser, context.now);
    if (event) return event;
  }

  if (stepwise !== "off" && context.currentPlan && CHANGE_REQUEST.test(lastUser)) {
    const revised = await revisePlanStepByStep(complete, lastUser, context.now, context.currentPlan);
    if (revised) return revised;
  }

  const first = await postAgent(baseUrl, path, message, system);
  if (first.kind === "output") return first.output;

  // The model wants to plan but can't write the whole plan in one answer
  // (or asks for dates the user already gave): ask it in small steps.
  if (stepwise !== "off" && wantsStepwisePlan(first.text, context, stepwise === "always")) {
    const planned = await planStepByStep(complete, lastUser, context.now);
    if (planned) return planned;
  }

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

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5 };

/**
 * The task the user numbered. "The first paper" / "paper 1" means "Review
 * paper 1", whichever T# the model picked: a small model mixes up which
 * reference belongs to which numbered task.
 */
function numberedTask(target: string, message: string, context: PlannerContext) {
  const chosen = context.tasks.find((task) => task.ref === target);
  if (!chosen) return target;
  const lower = message.toLowerCase();
  const said = Number(lower.match(/\b(?:paper|assignment|report|chapter|task|exercise|lab|essay)s?\s+(\d+)\b/)?.[1]) ||
    ORDINALS[lower.match(/\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\b/)?.[1] ?? ""];
  if (!said) return target;
  const family = chosen.title.replace(/[:\s]*\d+\s*$/, "").replace(/:.*$/, "").trim().toLowerCase();
  const match = context.tasks.find(
    (task) => task.title.toLowerCase().startsWith(family) && Number(task.title.match(/(\d+)\s*$/)?.[1]) === said,
  );
  return match?.ref ?? target;
}

/** The title behind a T#, S# or E# reference in the context. */
function namedTitle(target: string, context: PlannerContext) {
  if (target.startsWith("E")) return context.events?.find((event) => event.ref === target)?.title;
  if (target.startsWith("T")) return context.tasks.find((task) => task.ref === target)?.title;
  // A session is named through its task ("remove the Saturday paper session").
  return context.tasks.find((task) => task.sessions.some((session) => session.ref === target))?.title;
}

/** Whether a message names something with this title: "the weekly meeting" names "Weekly meeting". */
function mentions(message: string, title: string) {
  const words = (text: string) =>
    text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((word) => word.length > 2).map((word) => word.replace(/s$/, ""));
  const generic = new Set(["the", "and", "weekly", "session", "task", "with", "for"]);
  const said = new Set(words(message));
  return words(title).some((word) => !generic.has(word) && said.has(word));
}

/** Words of a to-do list: "I have…", "need to finish", "review", "this week", "gym". */
const LOOKS_LIKE_WORK = /\b(i have|i need|need to|have to|must|should|plan|finish|complete|review|study|write|prepare|read|practice|this week|next week|tomorrow|by (mon|tues|wednes|thurs|fri|satur|sun)day|assignments?|papers?|reports?|exams?|projects?|course|gym|workout|run(ning)?)\b/i;

/** The user's message says why: "because I'm sick", "since I'm overloaded". */
const GIVES_REASON = /\b(because|since|due to|as i|cause|cuz|sick|ill|unwell|busy|overloaded|family|emergency|exam|hospital)\b/i;

/**
 * What to do with the model's answer in tool-calling mode. Its first tool
 * call decides the action; heavy parts (a plan's sessions, an event's exact
 * time) are filled in step by step. No tool call means the model answered or
 * asked a question itself, which is shown as it is.
 */
async function actOnToolCall(
  text: string,
  complete: Complete,
  lastUser: string,
  context: PlannerContext,
): Promise<ModelOutput> {
  const calls = toolCallsIn(text);
  const words = textOutsideCalls(text);
  if (!calls.length) {
    // The model answered in words, but the message reads like a to-do list
    // ("this week I have 2 papers and gym"): a small model often describes a
    // plan instead of calling the tool. Ask it, part by part, whether these
    // are things to do; if they are, they get planned.
    if (LOOKS_LIKE_WORK.test(lastUser) && !/\?\s*$/.test(lastUser) && lastUser.split(/\s+/).length >= 4) {
      const planned = await planStepByStep(complete, lastUser, context.now);
      if (planned) return planned;
    }
    return {
      action: /\?\s*$/.test(words) ? "ask" : "chat",
      reply: words || "Could you tell me a bit more about what you need?",
    };
  }
  const { name, args } = calls[0];
  const value = (key: string) => (typeof args[key] === "string" ? (args[key] as string).trim() : "");
  // A reference with extra words ("T3 Demo slides", "M1 Priya Shah") → "T3".
  const ref = (key: string, letters: string) =>
    value(key).match(new RegExp(`\\b[${letters}]\\d+\\b`, "i"))?.[0].toUpperCase() ?? value(key);
  const today = dateOf(context.now);

  switch (name) {
    case "schedule_tasks": {
      const planned = await planStepByStep(complete, lastUser, context.now);
      return planned ?? { action: "ask", reply: "What would you like me to plan? Tell me the tasks and by when." };
    }
    case "change_current_plan": {
      if (!context.currentPlan) {
        return { action: "chat", reply: "There's no plan in this chat to change yet. Tell me what you need to get done and I'll plan it." };
      }
      const revised = await revisePlanStepByStep(complete, lastUser, context.now, context.currentPlan);
      return revised ?? { action: "ask", reply: 'What should I change? For example "move the papers to next week" or "max 4 hours a day".' };
    }
    case "add_calendar_event": {
      const event = await eventStepByStep(complete, lastUser, context.now, value("title"));
      if (event) return event;
      // No clock time and nothing like a meeting: it's work to plan ("2 papers
      // and gym for 1 hour"), not an appointment.
      if (!KNOWN_EVENTS.test(lastUser)) {
        const planned = await planStepByStep(complete, lastUser, context.now);
        if (planned) return planned;
      }
      return { action: "ask", reply: 'What day and time is it? For example "every Friday at 2pm".' };
    }
    case "update_task_status": {
      const updates = taskUpdatesSchema.safeParse([{ task: numberedTask(ref("task", "T"), lastUser, context), status: value("status") }]);
      return updates.success
        ? { action: "update", reply: "", taskUpdates: updates.data }
        : { action: "ask", reply: "Which task do you mean, and have you started or finished it?" };
    }
    case "remove_item": {
      // "Move the gym to next week" is a change, not a deletion.
      if (/\b(move|postpone|push|reschedule|delay|later|next week)\b/i.test(lastUser)) {
        if (context.currentPlan) {
          const revised = await revisePlanStepByStep(complete, lastUser, context.now, context.currentPlan);
          if (revised) return revised;
        }
        return {
          action: "chat",
          reply: context.currentPlan
            ? 'I couldn\'t tell which item to move. Name it, for example "move the gym to next week".'
            : "You've already started on that plan, so I can't reshuffle it from the chat any more. You can drag the session to another day on the calendar, or ask me to plan it again.",
        };
      }
      const target = numberedTask(ref("ref", "TSE").toUpperCase(), lastUser, context);
      if (!/^[TSE]\d+$/.test(target)) return { action: "ask", reply: "Which one should I remove?" };
      // Deleting is not undoable: only remove what the user's own words name.
      const named = namedTitle(target, context);
      if (!named || !mentions(lastUser, named)) {
        return { action: "ask", reply: "Which one should I remove? Tell me its name, for example \"cancel the weekly meeting\" or \"remove paper 2\"." };
      }
      const removal = target.startsWith("E") ? { event: target } : target.startsWith("S") ? { session: target } : { task: target };
      return { action: "remove", reply: "", removals: [removal] };
    }
    case "assign_task": {
      const assignments = assignmentsSchema.safeParse([
        // "M1 Priya Shah" → "M1".
        { assignee: ref("assignee", "M"), title: value("title"), priority: "medium", dueDate: dueDateFrom(args.due_date, lastUser, today) },
      ]);
      return assignments.success
        ? { action: "assign", reply: "", assignments: assignments.data }
        : { action: "ask", reply: "Who should I give it to, and what is the task?" };
    }
    case "email_assigner": {
      // A small model fills in a reason the user never gave ("I'm running
      // late"); without one in their own words, ask.
      if (!value("reason") || !GIVES_REASON.test(lastUser)) {
        return { action: "ask", reply: "Why can't you finish it on time? I'll put that in the message." };
      }
      const email = emailRequestSchema.safeParse({ task: ref("task", "T"), reason: value("reason") });
      return email.success
        ? { action: "email", reply: "", email: email.data }
        : { action: "ask", reply: "Which task can't you finish on time?" };
    }
    case "answer_yes":
      return { action: "confirm", reply: "" };
    case "answer_no":
    case "take_plan_off":
      return { action: "cancel", reply: "" };
    default:
      return { action: "chat", reply: words || "Could you tell me a bit more about what you need?" };
  }
}

/** One request to the agent server: an action from a tool call, or reply text. */
async function postAgent(
  baseUrl: string,
  path: string,
  message: string,
  system: string | undefined,
  timeoutMs?: number,
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
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : timeout(),
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
  event: {
    field: "events",
    schema: eventsSchema,
    shape: '"events": [{"title": "Weekly meeting", "date": "YYYY-MM-DD", "start": "14:00", "minutes": 60, "repeat": "weekly", "category": "work"}]',
  },
} as const;

/**
 * A reply that says something changed ("your updated plan is on your
 * calendar") when the action changes nothing. Small models copy the wording
 * of earlier replies in the conversation; the user must not be told a change
 * happened when it didn't.
 */
const CLAIMS_CHANGE = /\b(?:is|are) (?:now )?on your calendar\b|\b(?:updated|new) plan\b|\bI(?:'ve| have)? (?:added|moved|removed|updated|rescheduled|changed|deleted)\b/i;

function withoutFalseClaims(output: ModelOutput): ModelOutput {
  if ((output.action === "chat" || output.action === "ask") && CLAIMS_CHANGE.test(output.reply)) {
    console.warn("[planner] the model claimed a change it didn't make:", output.reply);
    return {
      action: "chat",
      reply: `I couldn't make that change, so nothing on your calendar has changed. Could you put it more simply? For example: "move the papers to next week" or "drop the gym".`,
    };
  }
  return output;
}

/**
 * True when the model chose to plan a new piece of work (with `always`), or
 * sent no usable plan, or asked for timing the user already gave. A small
 * model's one-shot plan tends to drop items and copy the prompt's examples,
 * so `always` is the default. Revisions of the current plan are left to
 * the normal path: the step-by-step planner only builds new plans.
 */
function wantsStepwisePlan(text: string, context: PlannerContext, always: boolean) {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  let raw: Record<string, unknown> | null = null;
  try {
    raw = JSON.parse(cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1));
  } catch {
    // A plan too long for the server's output limit arrives cut off, so it
    // isn't valid JSON; it is still an attempt to plan.
    return /"action"\s*:\s*"propose"/.test(cleaned) && !/"revise"\s*:\s*true/.test(cleaned);
  }
  if (!raw || typeof raw !== "object") return false;
  if (raw.action === "propose") {
    return raw.revise !== true && (always || !planIntentSchema.safeParse(raw.plan).success);
  }
  return askedForGivenDates(text, context) !== null;
}

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
/** A JSON string body ("line one\nline two") as text; the raw body if it won't decode. */
function safeUnescape(body: string) {
  try {
    return JSON.parse(`"${body}"`) as string;
  } catch {
    return body;
  }
}

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
  if (!parsed.success) {
    // Broken or cut-off JSON is never shown as it is. The model's own
    // "reply" is kept only for answers that change nothing: a cut-off
    // "propose" says "it's on your calendar" when nothing was added.
    if (/^\s*\{/.test(cleaned) || /"action"\s*:/.test(cleaned)) {
      const brokenAction = cleaned.match(/"action"\s*:\s*"(\w+)"/)?.[1];
      const harmless = brokenAction === "chat" || brokenAction === "ask";
      const replyText = harmless ? cleaned.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1] : undefined;
      const readable = replyText ? safeUnescape(replyText).trim() : "";
      return {
        action: "chat",
        reply: readable || "Sorry, my answer came out garbled and I couldn't act on it. Could you say that again, maybe a little shorter?",
      };
    }
    return { action: "chat", reply: cleaned };
  }

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
  if (action === "event") {
    const events = eventsSchema.safeParse(parsed.data.events);
    return events.success
      ? { action, reply, events: events.data }
      : { action: "ask", reply: "What should I put on your calendar, and on which day and time?" };
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
