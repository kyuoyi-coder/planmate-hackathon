# Connecting the planning model

This is everything you need to plug a locally trained model into PlanMate. You do not need to read the app's code.

## What the model does, and what it doesn't

The user types what they need to get done. Your model's job is the thinking:

- understand the request and decide whether to plan, ask a question, update a task, assign a task to a teammate, or just reply
- break the work down (for example, turn "study ML" into a sequence of topics)
- estimate how many hours each piece realistically takes

Your model does **not** pick dates or clock times. A scheduler in the app does that from your model's output: it spreads the sessions across the days before each deadline, keeps each day under the user's limit, adds breaks, and avoids what is already on the calendar. This split is deliberate. Small models are unreliable at date arithmetic, and it means the model can be trained on a much simpler task.

A plan goes onto the user's calendar as soon as your model proposes it; there is no confirmation step. The user changes it by chatting ("max 4 hours a day", "move it to next week"), which your model answers with a revised plan that replaces it, or takes it off again ("undo the plan", or the Undo button on the plan card). Once the user has started on a plan (ticked a session or changed a task's status), it is kept and can no longer be replaced as a whole.

## How the app calls the model

One HTTP request per user message, in the OpenAI chat-completions format:

```
POST {LLM_BASE_URL}/chat/completions
Content-Type: application/json

{
  "model": "<LLM_MODEL>",
  "messages": [
    { "role": "system", "content": "<instructions + the user's current situation>" },
    { "role": "user", "content": "This week I have 2 assignments, 3 papers to review, and I want to study ML" }
  ],
  "temperature": 0.3,
  "stream": false,
  "response_format": { "type": "json_object" }
}
```

The app reads the reply from `choices[0].message.content`.

Ollama, LM Studio, vLLM and the llama.cpp server all expose this endpoint already. If you serve the model with your own FastAPI app, implement this one route and return `{"choices": [{"message": {"content": "..."}}]}`.

`messages` holds the system prompt followed by up to the last 30 turns of the conversation. The system prompt is rebuilt on every request and contains today's date, the next 14 dates with weekdays, the user's working hours and daily limit, their tasks (each with a short reference such as `T2` and its status, followed by its calendar sessions with references such as `S5`, their dates and times), the teammates they are allowed to assign tasks to (references such as `M3`), the current plan from this chat (on the calendar and still replaceable), a message to an assigner waiting for the user's review, and any assignments held by the workload check. The exact text is in [lib/planner/prompt.ts](../lib/planner/prompt.ts); use it as the system prompt in your training data so training matches what the app sends.

## What the model must return

`content` must be one JSON object:

```json
{
  "action": "propose",
  "revise": false,
  "reply": "I've put 6 items, about 21 hours, on your calendar this week. Tell me what to change, or say \"undo the plan\".",
  "plan": {
    "items": [
      {
        "title": "Assignment 1",
        "category": "study",
        "priority": "high",
        "dueDate": "2026-11-20",
        "steps": [
          { "title": "Understand the brief and outline", "hours": 1 },
          { "title": "Do the main work", "hours": 1.5 },
          { "title": "Review and polish", "hours": 0.5 }
        ]
      },
      {
        "title": "Study ML",
        "category": "study",
        "priority": "medium",
        "steps": [
          { "title": "Supervised vs unsupervised learning, the training workflow", "hours": 1.5 },
          { "title": "Linear regression and gradient descent", "hours": 1.5 }
        ]
      }
    ],
    "constraints": { "maxHoursPerDay": 4, "daysOff": ["2026-11-22"], "startDate": "2026-11-16", "endDate": "2026-11-22" }
  }
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `action` | yes | `propose`, `ask`, `confirm`, `cancel`, `update`, `assign`, `remove`, `email` or `chat` (see below) |
| `reply` | yes | The text the user reads in the chat |
| `plan` | only for `propose` | The plan. For a revision, the complete updated plan, repeating the items that did not change |
| `revise` | with `propose` | `true` when the plan changes the current plan (it replaces it on the calendar); `false` for new, separate work, which is added alongside |
| `plan.items[].title` | yes | Short task name |
| `plan.items[].steps` | yes | Sessions, in the order they should happen. `hours` is a number; each step should be one sitting of at most 2 hours |
| `plan.items[].category` | no | `work`, `study`, `personal`, `exercise` or `rest`. Defaults to `work` |
| `plan.items[].priority` | no | `critical`, `high`, `medium` or `low`. Defaults to `medium` |
| `plan.items[].dueDate` | no | `YYYY-MM-DD`. Leave out when the user gave no deadline |
| `plan.constraints` | no | `maxHoursPerDay` (number), `daysOff` (list of dates), `startDate` and `endDate` (first and last day of the plan). For "next week", set `startDate` to next Monday so nothing is scheduled in the current week; leave it out when the plan starts today |
| `taskUpdates` | only for `update` | List of `{ "task": "T2", "status": "not-started" \| "ongoing" \| "completed" }`, using the task references from the system prompt |
| `removals` | only for `remove` | List of `{ "task": "T2" }` (the whole task and every session) or `{ "session": "S5" }` (that one session), using the references from the system prompt |
| `email` | only for `email` | `{ "task": "T2", "reason": "..." }`: the task the user can't finish on time (one a teammate assigned) and why, in their words |
| `assignments` | only for `assign` | List of `{ "assignee": "M3", "title": "...", "description": "...", "priority": "medium", "dueDate": "YYYY-MM-DD" }`, using the teammate references from the system prompt. Only `assignee` and `title` are required |

`priority` is visible to the user: `critical` sessions are red on the calendar and `high` ones amber, so use them for work the user calls urgent or important.

The nine actions:

| Action | When | Effect in the app |
| --- | --- | --- |
| `propose` | The model has enough to plan, or the user asked to change the current plan | The plan is scheduled and put on the calendar straight away. With `revise: true` it replaces the current plan |
| `ask` | Something essential is missing | `reply` is shown as a question |
| `confirm` | A held assignment or a drafted message is waiting and the user approves it ("assign anyway", "send it") | The held assignment is created, or the message is sent |
| `cancel` | The user drops what is waiting ("don't assign it", "don't send it"), or wants the current plan off the calendar ("undo the plan") | The held assignment or message is dropped, or the plan is removed |
| `update` | The user reports progress on an existing task ("I finished paper 2") | The task's status changes immediately, and its calendar sessions are ticked to match |
| `remove` | The user wants a task or one of its sessions gone ("remove assignment 2 on Saturday") | Deleted immediately; this cannot be undone. Removing a task's last session removes the task. The app refuses to delete a task a teammate assigned. When more than one session could be meant, the model should use `ask` and list each candidate with its full title and date |
| `assign` | The user asks to give a task to a teammate | The app first checks the assignee's workload (see below). With room, the task is created immediately. Otherwise it is held and the user is warned. The app rejects anyone outside the teammate list in the system prompt, which already reflects the user's role |
| `email` | The user can't finish a task a teammate assigned by its due date ("I can't finish the slides because I'm sick, tell my leader") | The app writes a message to whoever assigned the task and shows it in a popup for the user to review, edit, and send (a PlanMate notification, plus the user's email app opened with the message) or cancel. If the reason is missing, use `ask` first |
| `chat` | Anything else | `reply` is shown |

Two short examples:

```json
{ "action": "update", "reply": "Nice work, I marked paper 2 as completed.", "taskUpdates": [{ "task": "T4", "status": "completed" }] }
```

```json
{ "action": "assign", "reply": "Done, I assigned the demo slides to Priya, due Friday.", "assignments": [{ "assignee": "M5", "title": "Prepare the demo slides", "priority": "high", "dueDate": "2026-11-20" }] }
```

The parser is forgiving: it ignores `<think>...</think>` blocks, markdown fences and text around the JSON, and fills defaults for missing optional fields. If it finds no usable JSON, the raw text is shown to the user as a normal chat message, so a broken response degrades the experience instead of crashing it.

## The workload check on assignments

The model does not decide whether someone is too busy. It only sends `assign`. The app then checks the assignee's calendar for the period from today to the due date, and treats them as overloaded when any of these is true:

- a day in that period is already over their daily limit
- their planned focused work fills 80% or more of what their daily limit allows for the period
- the due date itself is 80% or more full (only when the user named the date)
- 6 or more unfinished tasks are already due in the period

When overloaded, the app holds the assignment and opens a popup for the assigner with the reasons, a day-by-day chart, and buttons to give it to a teammate who has room, move the deadline (a suggested free day or any date), assign anyway, or not assign. A new person or date is checked again. This is advice: the assigner can still go ahead. The held assignment appears in the system prompt under "Held assignments", and the model's job on the next turn is only to map the reply:

| The user says | Model returns |
| --- | --- |
| "assign anyway", "yes, go ahead" | `confirm` |
| "give it to Devin instead" | a new `assign` with the same title and the new assignee (checked again) |
| "make it due next Wednesday" | a new `assign` with the same title and assignee and the new date (checked again) |
| "never mind" | `cancel` |

The thresholds are in [lib/workload.ts](../lib/workload.ts).

## Switching it on

In `.env.local`:

```
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=planmate
```

Optional: `LLM_API_KEY` (sent as a Bearer token), `LLM_TIMEOUT_MS` (default 120000), `LLM_JSON_MODE=off` if your server rejects the `response_format` field, `LLM_PROMPT=full` to send the longer example-free contract instead of [docs/model/PLANMATE_SYSTEM_PROMPT.md](model/PLANMATE_SYSTEM_PROMPT.md) (the default, sized for small models), and `LLM_SEND_POLICY=on` to put the model's general policy ([lib/planner/policy.md](../lib/planner/policy.md), ~8k tokens) in front: leave it off for small models. Restart `npm run dev` after changing these.

With `LLM_PROVIDER=mock` (the default, used only when `LLM_PROVIDER` is unset or `mock`; any other unknown value is an error, never a silent fallback), the app uses a small rule-based planner in [lib/planner/mock.ts](../lib/planner/mock.ts) that follows the same contract. It is a stand-in for building and demoing the app, and a source of example input/output pairs; it only understands simple phrasings.

### Agent servers with a single `/chat` endpoint

Some model servers are an agent wrapper rather than a raw model: one `POST /chat` that takes `{"message", "thread_id"}` and returns `{"reply", "blocked", "tool_calls", ...}`, with no system prompt and a cap on the message size. For those:

```
LLM_PROVIDER=agent-chat
LLM_BASE_URL=http://10.131.151.20:8000
```

Optional: `LLM_AGENT_PROMPT` (`inline`, the default; `server` once the server loads [docs/model/PLANMATE_SYSTEM_PROMPT.md](model/PLANMATE_SYSTEM_PROMPT.md) itself; `system` to send the full prompt in a `system` field), `LLM_CHAT_PATH` (default `/chat`), `LLM_MAX_MESSAGE_CHARS` (default 8000), `LLM_API_KEY`, `LLM_TIMEOUT_MS`, and `LLM_REPAIR=off` to skip the one retry PlanMate makes when an answer names an action but lacks its field (for example `assign` without `assignments`). The setup guide for the model server is [docs/model/SERVER_SETUP.md](model/SERVER_SETUP.md).

Each turn sends one message built by `buildCompactMessage` in [lib/planner/prompt.ts](../lib/planner/prompt.ts): a shortened version of the contract above, the user's situation (dates, tasks with their T#/S# references, teammates as M#, any held assignment, message under review or current plan), and the recent conversation. Old turns, then the longest-ago tasks, are dropped to fit the cap. Every turn uses a new `thread_id`, because the message already carries the conversation and the server's memory would otherwise drift from what is on the calendar.

The answer is used as the model gave it; nothing is filled in by the mock:

1. a tool call named after an action (`propose`, `update`, ..., optionally prefixed `planmate_`) whose arguments are the rest of the JSON object is used as that action;
2. otherwise a JSON object in `reply` is used as the action;
3. otherwise the text of `reply` is shown to the user as the model's chat answer (so no calendar change happens). A `blocked` reply is shown as it is.

**What the server has to allow.** The wrapper must let the PlanMate message through to the model and let the model answer in JSON. If the agent puts its own system prompt or verifier in front ("I can only use the calculator", "I could not verify a reliable next action"), the model never sees the contract and PlanMate can only show its text. In that case, either:

- serve the raw model as well, at an OpenAI-compatible `/v1/chat/completions` (vLLM, Ollama, LM Studio and llama.cpp all do this), and use `LLM_PROVIDER=openai-compatible`. This is the best option: PlanMate then sends the full contract as the system prompt and asks for JSON mode; or
- add a PlanMate mode to the agent: no built-in system prompt or verifier for these requests and a cap of at least 8000 characters, returning the model's raw text in `reply`. Alternatively, register the nine actions as tools that are **returned in `tool_calls` without being executed**, since PlanMate does the executing.

## Checking the model on its own

```bash
curl http://localhost:11434/v1/chat/completions -H "Content-Type: application/json" -d '{
  "model": "planmate",
  "messages": [
    {"role": "system", "content": "<paste a system prompt>"},
    {"role": "user", "content": "By Friday I need to finish a report and prepare a presentation"}
  ]
}'
```

A good response is a single JSON object with `"action": "propose"`, honest hour estimates, and no dates or times inside `steps`.
