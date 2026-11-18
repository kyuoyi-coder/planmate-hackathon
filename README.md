# PlanMate

Tell the AI assistant what you need to get done. It works out a balanced schedule that keeps you under your daily limit, checks it with you, and only then puts it on your calendar.

## Setup

You need Node.js 20+ and a running PostgreSQL server.

1. Create a database:

   ```sql
   CREATE DATABASE planmate;
   ```

2. Copy `.env.example` to `.env.local` and set `DATABASE_URL` to your connection string.

3. Install, create the tables, and add yourself as a user:

   ```bash
   npm install
   npm run db:migrate
   npm run user:add -- --name "Your Name" --email you@example.com --password "at-least-8-chars" --role leader
   ```

4. Start the app and sign in at http://localhost:3000:

   ```bash
   npm run dev
   ```

## Users and roles

There is no sign-up page. Accounts are created with `npm run user:add`, which stores the password hashed. Running it again with the same email updates that user's name, role and password.

| Role | `--role` | Can assign tasks to |
| --- | --- | --- |
| Team leader | `leader` | Anyone |
| Sub-leader | `sub-leader` | Members |
| Member | `member` (default) | Nobody; members only receive tasks |

Tasks are assigned by asking the assistant ("assign the demo slides to Priya by Friday"). The rule lives in [lib/roles.ts](lib/roles.ts) and is enforced on the server.

## The planning model

The app runs with a built-in rule-based planner until a real model is connected (`LLM_PROVIDER=mock`). To connect a model, see [docs/LLM_INTEGRATION.md](docs/LLM_INTEGRATION.md).

## How it fits together

| Part | Where |
| --- | --- |
| Pages (calendar, planning board, reports, shared tasks, members) | `app/(app)/` |
| Login page | `app/(auth)/login/` |
| Reads: the data access layer used by Server Components | [lib/data.ts](lib/data.ts) |
| Writes: Server Actions (login, chat, calendar changes) | [app/actions.ts](app/actions.ts) |
| Loading skeletons | [components/skeletons.tsx](components/skeletons.tsx) |
| Chat turn handling: model call, plans, assignments, messages to assigners | [lib/planner/agent.ts](lib/planner/agent.ts) |
| Notifications and the Shared Tasks count | [lib/notifications.ts](lib/notifications.ts) |
| "Can't finish on time" message to the assigner (opened in the user's email app via mailto:) | [lib/email.ts](lib/email.ts), [lib/mailto.ts](lib/mailto.ts) |
| Scheduler that turns the model's plan into calendar blocks | [lib/planner/scheduler.ts](lib/planner/scheduler.ts) |
| Model adapter and the prompt it sends | [lib/planner/provider.ts](lib/planner/provider.ts), [lib/planner/prompt.ts](lib/planner/prompt.ts) |
| Database schema | [lib/db/schema.ts](lib/db/schema.ts) |

After changing the schema, run `npm run db:generate` to create a migration and `npm run db:migrate` to apply it.
