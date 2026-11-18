# Connecting your model server to PlanMate

PlanMate is a planner app. Its chat sends the model the user's message and their current tasks, and expects back **one JSON object** describing what to do: plan, update, remove, assign, email, and so on. PlanMate carries the action out itself: the database writes, calendar scheduling and workload checks. The model does not need tools, database access or training on our data. It needs to:

1. receive PlanMate's instructions as its system prompt, and
2. return its raw answer (the JSON) in `reply`, without a wrapper prompt or verifier rewriting or blocking it.

## Files in this folder

| File | What it is |
| --- | --- |
| `PLANMATE_SYSTEM_PROMPT.md` | The system prompt for PlanMate requests: the JSON contract, rules and 10 worked examples. Load it as-is. |
| `planmate-tools.json` | The same nine actions as OpenAI-style function tools, if you would rather use native tool calling. |
| `planmate-output.schema.json` | JSON Schema (draft-07) of a valid answer: one object per action, each with its required field. Use it for constrained decoding. |
| `../../lib/planner/policy.md` | Your `agent.md` (general behaviour, privacy). **Not sent by default**: at about 32,000 characters (~8k tokens) it is too long for a 1.5B model. See *Sizing* below. |

## What PlanMate sends today

`POST {LLM_BASE_URL}/chat`

```json
{
  "thread_id": "planmate-<uuid>",
  "message": "# Runtime context (trusted, supplied by the PlanMate application)\nNow: 2026-11-18T10:00 (Wednesday). User: Hana Kim ...\nTasks:\nT1 Review paper 1 [not-started] due 2026-11-20; sessions: S1 2026-11-19 09:00\n\n# Conversation:\nUser: I finished paper 1\n\nRespond to the last User message with the JSON object required by the contract.",
  "system": "(only in mode \"system\", see below)"
}
```

- Each turn uses a **new `thread_id`**, because the message already contains the recent conversation. You don't need to keep memory for PlanMate threads.
- Every `thread_id` starts with `planmate-`, so your server can tell PlanMate requests apart from other clients.

PlanMate reads the response like this:

```json
{ "reply": "{\"action\":\"update\",\"reply\":\"Marked Review paper 1 as completed.\",\"taskUpdates\":[{\"task\":\"T1\",\"status\":\"completed\"}]}", "blocked": false, "tool_calls": [] }
```

- If `reply` contains the JSON object, it becomes the action.
- If `tool_calls` contains a call named after an action (`propose`, `update`, …, optionally prefixed `planmate_`), its arguments are used instead. **Return the call; don't execute it.** PlanMate executes it.
- Any other text is shown to the user as a plain chat answer, and nothing happens.

## What to change on the server: pick one option

### Option A: PlanMate mode on `/chat` (smallest change)

For requests whose `thread_id` starts with `planmate-`:

1. Use `PLANMATE_SYSTEM_PROMPT.md` as the system prompt instead of the agent's own prompt (calculator, date tools, etc.).
2. Skip the verifier, or at least don't replace the answer with "I could not verify a reliable next action". PlanMate validates every action itself before touching the database.
3. Don't run tools. Return the model's text unchanged in `reply`.
4. Use temperature around 0.2–0.3, and JSON mode / grammar-constrained decoding if your runtime has it (vLLM `guided_json`, llama.cpp `json_schema`, Ollama `format: "json"`).

Sketch (FastAPI):

```python
PLANMATE_PROMPT = Path("PLANMATE_SYSTEM_PROMPT.md").read_text(encoding="utf-8")

@app.post("/chat")
def chat(body: ChatIn):
    if body.thread_id.startswith("planmate-"):
        system = body.system or PLANMATE_PROMPT          # optional `system` field, see below
        text = llm.generate(
            messages=[{"role": "system", "content": system},
                      {"role": "user", "content": body.message}],
            temperature=0.2,
            response_format={"type": "json_object"},       # if supported
        )
        return {"reply": text, "thread_id": body.thread_id, "blocked": False,
                "verifier_margin": None, "tool_calls": []}
    ...  # existing agent path unchanged
```

In PlanMate's `.env.local`:

```
LLM_PROVIDER=agent-chat
LLM_BASE_URL=http://<server>:8000
LLM_AGENT_PROMPT=server
```

`LLM_AGENT_PROMPT` has three settings:

- `server`: you load the prompt file, and PlanMate sends only the runtime context and conversation.
- `system`: PlanMate also sends the full prompt in a `system` field. Add `system: str | None = None` to `ChatIn`.
- `inline` (the default): a shortened prompt is packed into the 8000-character message, for servers that can't change.

### Option B: OpenAI-compatible endpoint (best, no PlanMate changes)

Serve the raw Qwen model with vLLM, Ollama, LM Studio or llama.cpp's server. All of them expose `/v1/chat/completions`. PlanMate then sends `PLANMATE_SYSTEM_PROMPT.md` plus the runtime context as the system prompt, sends the recent conversation as chat messages, and asks for JSON mode:

```
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=http://<server>:8000/v1
LLM_MODEL=<model name>
```

### Option C: native tool calling

Register the nine tools in `planmate-tools.json` for PlanMate requests, and return the model's tool call in `tool_calls` (name and arguments) **without executing it**. PlanMate reads it from there.

## Sizing for Qwen2.5-1.5B-Instruct

What PlanMate sends per turn, by default:

| Part | Size |
| --- | --- |
| `PLANMATE_SYSTEM_PROMPT.md` (rules + 10 examples) | ~10,200 characters ≈ 2.8k tokens |
| Runtime context: dates, tasks, teammates | ~0.7k characters with no tasks, ~3.7k with 30 tasks ≈ 0.2–1k tokens |
| Recent conversation (up to 12 messages) | usually < 0.5k tokens |
| Model's answer | up to ~0.6k tokens for a large plan |
| **Total** | **≈ 3.5–5k tokens** |

With `LLM_AGENT_PROMPT=inline` (the default for a server that can't load the prompt file), it is a shorter contract without examples: ≈ 1–2k tokens in all.

Settings that matter for a 1.5B model:

- **Context window of at least 8192 tokens.** Ollama defaults to 2048–4096 and silently cuts the *start* of the prompt, which is where the instructions are. Set `num_ctx` to 8192 (or `PARAMETER num_ctx 8192` in the Modelfile). For vLLM use `--max-model-len 8192`; for llama.cpp use `-c 8192`.
- **Don't add `agent.md`** to PlanMate requests (PlanMate sends it only with `LLM_SEND_POLICY=on`). It would triple the prompt, and a small model follows a short contract with examples much better than a long policy.
- **Constrained JSON decoding** (`format: "json"`, `guided_json`, `json_schema`). At 1.5B parameters this is the difference between "mostly valid JSON" and "always valid JSON".
- **Temperature 0.1–0.3.**

## Constrained decoding with `planmate-output.schema.json`

Tested against Qwen2.5-1.5B on 2026-11-18, with no constrained decoding. The model always answered in JSON and usually picked the right action, but often left out the field that carries it. For example, it sent `"action": "assign"` with no `assignments`, or `"action": "propose"` with no `plan`. Once it also wrote invalid JSON (unescaped quotes inside `reply`).

PlanMate gives the model one retry with the exact error, which fixes some of these, but constraining the output to this schema fixes them at the source. The schema makes the required field mandatory for each action, so those answers can't be produced.

```python
SCHEMA = json.loads(Path("planmate-output.schema.json").read_text())

# vLLM (OpenAI-compatible server)
client.chat.completions.create(model=..., messages=..., temperature=0.2,
                               extra_body={"guided_json": SCHEMA})
# Ollama (0.5+)
ollama.chat(model=..., messages=..., format=SCHEMA, options={"temperature": 0.2, "num_ctx": 8192})
# llama.cpp server: POST /completion with {"json_schema": SCHEMA, ...}
# HF transformers: lm-format-enforcer (JsonSchemaParser(SCHEMA)) or outlines (outlines.generate.json(model, json.dumps(SCHEMA)))
```

Only use the schema for `planmate-` threads.

## Checking it works

Paste a real PlanMate message (the runtime context and conversation from above) and call the server. A good answer is a single JSON object that matches the examples in `PLANMATE_SYSTEM_PROMPT.md`:

| User says | Expected `action` |
| --- | --- |
| hi | `chat` |
| I need to review 2 papers by Friday | `propose` with 2 items, `dueDate` Friday, `revise` false |
| I finished paper 1 | `update`, `T1` → `completed` |
| remove review paper 1 (two sessions) | `ask`, listing both dates |
| assign the test plan to Priya by Monday | `assign`, `M1` |
| I can't finish the demo slides, I'm sick, tell my leader | `email`, `T2`, reason "I'm sick" |

## If the model still gets the format wrong

A 1.5B model will understand most commands with the prompt above, but expect slips on harder turns: long multi-item plans, the `revise` flag, and choosing `ask` over guessing on ambiguous removals. In order of effort:

1. Turn on constrained JSON decoding (the biggest win).
2. Lower the temperature.
3. Fine-tune (LoRA) on input/output pairs in this format. For a 1.5B model this is cheap (a few hundred to a couple of thousand examples, minutes to an hour on one consumer GPU), and it is the most reliable fix. PlanMate can generate the pairs: each one is the runtime-context message plus the expected JSON, like the 10 in the prompt file. After fine-tuning, the 10k-character prompt can shrink to a short reminder.
