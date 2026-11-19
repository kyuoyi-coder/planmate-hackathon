import { addDays, dateOf, weekdayName } from "@/lib/time";
import { dueDateIn } from "./dates";
import type { ChatTurn, PlannerContext } from "./types";

/**
 * PlanMate's actions as native tools for small tool-calling models.
 *
 * The organizers' Qwen2.5-1.5B was trained (When2Call) to decide between
 * calling a tool, asking a follow-up question, declining and answering
 * directly, with simple tools whose arguments are a few flat values. So the
 * tools here are that shape: the model decides *what* to do and fills in
 * references (T1, M2, E1) and short values; PlanMate's code does the heavy
 * parts (breaking work into sessions, reading exact times) in small steps.
 *
 * The tools are written into the system prompt exactly the way Qwen2.5's own
 * chat template does (`<tools>` … `<tool_call>`), so this works with any
 * server that passes our system prompt through, and the model's answer is
 * read from `<tool_call>` blocks in its reply.
 */

type Tool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: { type: "object"; properties: Record<string, unknown>; required: string[] };
  };
};

const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): Tool => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});

export const PLANMATE_TOOLS: Tool[] = [
  fn("schedule_tasks", "Schedule the tasks and activities the user lists (papers, assignments, reports, study, gym, free-time activities) on their calendar. PlanMate works out the sessions and times."),
  fn("change_current_plan", "Change items that are already in the Current plan: move them to next week, drop them, set a daily hour limit or keep a day free. Not for new work or events."),
  fn(
    "update_task_status",
    "The user reports progress on one of their listed tasks: started it (ongoing) or finished it (completed).",
    {
      task: { type: "string", description: "Task reference from the list, e.g. T1" },
      status: { type: "string", enum: ["not-started", "ongoing", "completed"] },
    },
    ["task", "status"],
  ),
  fn(
    "remove_item",
    "Delete or cancel one listed task (T#), calendar session (S#) or fixed event (E#). Cancelling the weekly meeting means its E#.",
    { ref: { type: "string", description: "T#, S# or E# from the lists" } },
    ["ref"],
  ),
  fn(
    "add_calendar_event",
    "Put a NEW fixed appointment at a clock time (like 2pm or 10:00) on the calendar: a meeting, class, call or appointment, once or every week.",
    { title: { type: "string", description: "Short name, e.g. Weekly meeting" } },
    ["title"],
  ),
  fn(
    "assign_task",
    "Give a task to a listed teammate (M#). Only when teammates are listed.",
    {
      assignee: { type: "string", description: "Teammate reference, e.g. M2" },
      title: { type: "string" },
      due_date: { type: "string", description: "YYYY-MM-DD, if the user gave one" },
    },
    ["assignee", "title"],
  ),
  fn(
    "email_assigner",
    "The user can't finish a task someone assigned them on time: draft a message to that person for the user to review.",
    {
      task: { type: "string", description: "Task reference, e.g. T3" },
      reason: { type: "string", description: "Why, in the user's words" },
    },
    ["task", "reason"],
  ),
  fn("answer_yes", "The user says yes to what is waiting for their decision."),
  fn("answer_no", "The user says no to what is waiting for their decision."),
  fn("take_plan_off", "The user wants the whole Current plan taken off the calendar (\"undo the plan\")."),
];

/**
 * Only the tools that apply right now, which is also what When2Call
 * measures: no yes/no tools when nothing awaits a decision, no plan-change
 * tools without a plan, no assigning for a user who can't. A small model
 * chooses reliably between fewer, relevant tools.
 */
export function toolsFor(context: PlannerContext) {
  const pending = Boolean(context.heldAssignments?.length || context.pendingEmail);
  const unavailable = new Set<string>([
    ...(pending ? [] : ["answer_yes", "answer_no"]),
    ...(context.currentPlan ? [] : ["change_current_plan", "take_plan_off"]),
    ...(context.teammates.length ? [] : ["assign_task"]),
    ...(context.tasks.some((task) => task.assignedBy) ? [] : ["email_assigner"]),
    ...(context.tasks.length ? [] : ["update_task_status"]),
    ...(context.tasks.length || context.events?.length ? [] : ["remove_item"]),
  ]);
  return PLANMATE_TOOLS.filter((tool) => !unavailable.has(tool.function.name)).map((tool) =>
    // The plan's items go in the tool itself: a "Current plan" line in the
    // context made the model treat every new request as a change to it.
    tool.function.name === "change_current_plan" && context.currentPlan
      ? {
          ...tool,
          function: {
            ...tool.function,
            description: `${tool.function.description} Items in the current plan: ${context.currentPlan.items.map((item) => item.title).join(", ")}.`,
          },
        }
      : tool,
  );
}

/** The system prompt: who PlanMate is, then the tools exactly as Qwen2.5's chat template writes them. */
export function toolSystemPrompt(context: PlannerContext) {
  return `You are PlanMate, a planning assistant that protects the user's work-life balance. Use a tool when the user asks for something a tool does, with references (T#, S#, E#, M#) from the lists you are given. If something the tool needs is missing, ask one short question. If no tool fits, answer briefly yourself.

# Tools

You may call one or more functions to assist with the user query.

You are provided with function signatures within <tools></tools> XML tags:
<tools>
${toolsFor(context).map((tool) => JSON.stringify(tool)).join("\n")}
</tools>

For each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:
<tool_call>
{"name": <function-name>, "arguments": <args-json-object>}
</tool_call>`;
}

/** The user message for a tool-calling turn: what the user has, then the conversation. */
export function toolUserMessage(context: PlannerContext, history: ChatTurn[], maxChars: number) {
  const today = dateOf(context.now);
  const dates = Array.from({ length: 14 }, (_, offset) => {
    const date = addDays(today, offset);
    return `${date} ${weekdayName(date).slice(0, 3)}`;
  }).join(", ");
  const lines = [
    `Today: ${context.now.replace("T", " ")} (${weekdayName(today)}). Dates: ${dates}`,
    `Tasks: ${context.tasks.length ? "" : "none"}`,
    ...context.tasks.map(
      (task) =>
        `${task.ref} ${task.title} [${task.status}] due ${task.dueDate}${task.assignedBy ? `, assigned by ${task.assignedBy}` : ""}` +
        (task.sessions.length ? `; sessions: ${task.sessions.map((s) => `${s.ref} ${s.date} ${s.start}`).join(", ")}` : ""),
    ),
    `Fixed events: ${context.events?.length ? context.events.map((event) => `${event.ref} ${event.title}, ${event.when}`).join("; ") : "none"}`,
    `Teammates: ${context.teammates.length ? context.teammates.map((m) => `${m.ref} ${m.name} (${m.role})`).join(", ") : "none (this user cannot assign tasks)"}`,
    `Waiting for the user's decision: ${
      context.heldAssignments?.length
        ? `assigning "${context.heldAssignments[0].title}" to ${context.heldAssignments[0].assignee}`
        : context.pendingEmail
          ? `a message to ${context.pendingEmail.to} about "${context.pendingEmail.task}"`
          : "nothing"
    }`,
  ];
  // Only the latest message, plus PlanMate's turn before it when that was a
  // question being answered. The user's tasks, events and plan are listed
  // above already; given older turns, a small model repeats its previous
  // tool call ("add the meeting" again for the next, unrelated request).
  const lastUserIndex = history.findLastIndex((turn) => turn.role === "user");
  const previous = history[lastUserIndex - 1];
  const turns = [
    ...(previous?.role === "assistant" && /\?\s*$/.test(previous.content) ? [`PlanMate: ${previous.content}`] : []),
    ...(lastUserIndex >= 0 ? [`User: ${history[lastUserIndex].content}`] : []),
  ];
  const build = () => `${lines.join("\n")}\n\nConversation:\n${turns.join("\n")}`;
  // Keep the latest user turn; drop old turns, then the longest-ago tasks.
  while (build().length > maxChars && turns.length > 1) turns.shift();
  while (build().length > maxChars && lines.length > 3) lines.splice(2, 1);
  return build().slice(-maxChars);
}

export type ToolCall = { name: string; args: Record<string, unknown> };

/**
 * The tool calls in a model answer: Qwen's `<tool_call>{…}</tool_call>`
 * blocks, or a bare `{"name": …, "arguments": …}` object.
 */
export function toolCallsIn(text: string): ToolCall[] {
  const bodies = [...text.matchAll(/<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|$)/g)].map((m) => m[1]);
  if (!bodies.length && /^\s*\{[\s\S]*"name"[\s\S]*\}\s*$/.test(text)) bodies.push(text.trim());
  const calls: ToolCall[] = [];
  for (const body of bodies) {
    try {
      const json = JSON.parse(body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1));
      const name = typeof json?.name === "string" ? json.name : "";
      if (!PLANMATE_TOOLS.some((tool) => tool.function.name === name)) continue;
      const raw = json.arguments ?? json.parameters ?? {};
      const args = typeof raw === "string" ? JSON.parse(raw) : raw;
      calls.push({ name, args: args && typeof args === "object" ? args : {} });
    } catch {
      // A broken call is skipped; if none is usable, the text is used.
    }
  }
  return calls;
}

/** The model's words outside any tool call: its direct answer or question. */
export const textOutsideCalls = (text: string) =>
  text.replace(/<tool_call>[\s\S]*?(<\/tool_call>|$)/g, "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

/** A due date the model gave, or one in the user's own words ("by Friday"). */
export function dueDateFrom(value: unknown, lastUser: string, today: string) {
  // The user's own words ("by Monday") first: the model's date arithmetic is unreliable.
  const said = dueDateIn(lastUser, today);
  if (said) return said;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= today) return value;
  return addDays(today, 7);
}
