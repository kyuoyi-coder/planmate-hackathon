# PlanMate: App Overview

> **Plan the work. Protect the person.**
> PlanMate is a work-life balance assistant for anyone who wants their own planning space and also works as part of a team. You tell it, in plain words, what you need to get done. It turns that into a realistic schedule that leaves room for the rest of your life. It asks you before saving anything, and it warns team leaders before they overload a teammate.

---

## 1. The problem

Work-life balance usually breaks quietly. Nobody decides to overwork; it happens one "small" extra task at a time, until evenings and weekends are gone. Most planning tools are good at holding tasks and bad at protecting the people doing them.

- **Planning takes effort.** Turning "two reports, three documents to review, and I want to learn ML" into a schedule means estimating hours, splitting big topics into sessions, and fitting them around everything else. Most people skip this and just start.
- **Calendars don't say no.** You can book ten hours of focused work on a Tuesday and nothing warns you. Burnout shows up later, as missed deadlines and exhaustion.
- **Big goals stay vague.** "Study machine learning" sits on a to-do list for weeks because it's a direction, not a first step.
- **Leaders can't see each person's load.** A team leader hands out a task without seeing that the person already has a full week. The task gets accepted and the overload stays hidden.

## 2. The idea

PlanMate puts an AI assistant beside your calendar. You talk to it the way you'd talk to a friend who's good at planning:

> "This week I have 2 assignments to complete, 3 papers to review, and I want to study ML. Max 4 hours a day and keep Sunday free."

The assistant does the thinking: it breaks the work down, estimates how long each part takes, and turns "study ML" into a sequence of real sessions. A scheduler then places those sessions on your calendar under rules you can rely on: daily limits, breaks, a free lunch hour, and no stacking on top of existing commitments.

**It just does it, and you stay in charge.** The plan goes straight onto your calendar. Not quite right? Tell the assistant ("max 4 hours a day", "move it to next week") and it reschedules, or say "undo the plan" to take it off. Once you've started on a plan, your progress is protected.

## 3. Who it's for

PlanMate is for **anyone who wants their own planning space and also works as part of a team**: a project team, a startup, a club, a research group, a department. Every person gets two things in one place:

- **Their own space.** A personal calendar, task board and assistant that plan around *their* daily limit and working hours. Nobody else plans their day for them.
- **The team around them.** Tasks teammates hand out arrive in the same space, and whoever assigns them can see first whether the person has room.

| Role | What PlanMate does for them |
| --- | --- |
| **Everyone** | Turns a messy list into a balanced week, splits big goals into sessions, tracks progress by chat ("I finished the report"), and shows how their time splits between work and the rest of life. |
| **Team leader** | Assigns tasks to anyone by asking the assistant, and gets a workload warning before overloading someone. |
| **Sub-leader** | Assigns tasks to members, with the same workload warning. |
| **Member** | Gets their own plan, and sees tasks teammates assigned to them in one place. |

## Why "work-life balance" is the core

PlanMate is not a to-do app with an AI bolted on. Every feature serves one goal: **getting the work done without giving up the rest of your life.**

| Feature | How it protects balance |
| --- | --- |
| Daily limit, breaks, free lunch, weekends last | Your plan can't quietly eat your evenings. |
| Splitting big goals into sessions | Progress happens in sustainable steps instead of last-minute marathons. |
| Confirm before saving | You stay in charge of your own time. |
| Workload check on assignments | A team can't overload one person without noticing. |
| Reports page | You see work vs personal, exercise and rest hours, overtime, and whether you stayed within your boundaries. |

## 4. A walk through the app

### Signing in

PlanMate is a private workspace for a known group of people, so there's no public sign-up. The owner adds each person directly to the database with a name, email, password, and role. Each person signs in with email and password.

- A sign-in lasts **one day**, then the user signs in again.
- Passwords are stored hashed. The session token in the browser cookie is stored hashed on the server too, so a database leak doesn't hand out working sessions.

### The layout

Every page has three parts:

1. **Sidebar (left):** navigation, the signed-in user, sign out, and the Light / Dark / System theme switch.
2. **Main area (centre):** the current page.
3. **PlanMate AI (right):** the chat assistant, always available on every page.

Each time you open the site or sign in, the chat starts **fresh**. Earlier conversations stay in the chat history and can be reopened or deleted. Moving between pages keeps the open conversation.

### Calendar

The calendar shows every planned session, with Month, Week, Day and Agenda views.

- **Agenda** covers the whole calendar month (for example 1–30 November), and its table scrolls on its own so the page stays still.
- **Switching views** always jumps to the current period, so you're never looking at last month by accident.
- **Urgent work stands out:** critical-priority sessions are red and high-priority ones amber.
- **Tick to complete:** each session has a tick box. Ticking it strikes the session through and updates the task's status on the Planning page.
- **Drag and drop:** sessions can be moved or resized directly on the calendar.

### Planning (task board)

All your tasks with priority, due date, estimated hours, and status (not started, ongoing, completed). There are no manual status dropdowns: you just tell the assistant ("I finished paper 2") and the board updates. Ticking the calendar sessions does the same.

### Shared Tasks

Tasks teammates assigned to you, with who assigned them and when they're due. There's no assign form: assigning happens by asking the assistant.

Leaders and sub-leaders also see an **Assigned by you** board here: every task they handed out, who is doing it, and whether it's not started, ongoing, or completed.

### Notifications

Small pop-up notices (toasts) keep the team in sync without anyone having to chase:

- **Deadline reminder:** the day before a task a teammate assigned is due, the assignee gets a reminder ("*"Launch checklist" is due tomorrow, assigned by Alex*"), unless it's already done.
- **Completed notice:** when an assignee completes a task, from the chat or by ticking it on the calendar, whoever assigned it gets a notice, and it moves to Completed on their **Assigned by you** board.

- **Can't finish on time:** when an assignee sends a "can't finish" message, the leader gets a notice with the reason, and the task on their **Assigned by you** board shows *Can't finish on time: reason*. **Send** also opens the message in the assignee's own email app (a `mailto:` link), ready to send from their address.

The sidebar shows how many tasks from teammates are still unfinished next to **Shared Tasks**; the badge turns ember when one is due by tomorrow.

Each notice appears once and stays until it's closed. Its **View** button opens Shared Tasks. The app checks for new notices every 30 seconds while it's open.

### Reports: work-life balance

A weekly or monthly view of how you're actually spending your time:

- **Time breakdown:** Work and study, Personal, Exercise, Rest, and Unscheduled hours.
- **Work boundary respected:** the share of days you stayed within your preferred hours.
- **Overtime:** hours beyond your limit.
- **Tasks completed:** completed versus planned.
- **Workload balance:** a quick healthy-or-not signal.

### Members

The team directory: everyone in the workspace with their role (Team leader, Sub-leader, Member). The demo workspace comes with 13 example members.

## 5. The assistant: what you can say to it

| You say | What happens |
| --- | --- |
| "This week I have 2 assignments, 3 papers to review, and I want to study ML" | **Plan.** It breaks the work into sessions and puts them on your calendar across this week. To change it or take it off again, you just tell the agent. |
| "Plan next week: 1 urgent report and 1 presentation" | **Plan for next week only.** The plan starts next Monday and nothing is put in the current week. |
| "Max 4 hours a day and keep Sunday free" | **Reschedule.** The plan on your calendar is rebuilt with the new limits. |
| "Move it to next week" | **Reschedule.** The same plan moves to next week. |
| "Undo the plan" | **Undo.** The plan comes off your calendar and Planning board. |
| "I can't finish the launch checklist because I'm sick, tell my leader" | **Tell your leader.** It drafts a message to whoever assigned the task and opens it in a popup, where you can edit it, then **Send** (which notifies them in PlanMate and opens your email app with the message ready) or **Cancel**. |
| "I finished paper 2" | **Update.** The task is marked completed and its sessions are ticked. |
| "Remove assignment 2" | **Clarify, then remove.** If two tasks match, it asks which one you mean, listing each one's full name and date. |
| "Remove assignment 2 set on Sat" | **Remove precisely.** If exactly one matching session is on Saturday, it's removed straight away. |
| "Assign the demo slides to Priya by Friday" | **Assign** (leaders and sub-leaders only). It first runs a workload check on that person (see section 7). |

### Turning a big topic into a learning path

Deep topics aren't scheduled as one vague block. "Study ML" becomes a progression of sessions, for example:

1. Supervised vs unsupervised learning, the training workflow
2. Linear regression and gradient descent
3. …and so on, each one a sitting of two hours at most.

Assignments are split the same way: *understand the brief and outline → do the main work → review and polish*.

## 6. How burnout protection works

This is the heart of PlanMate. The AI decides **what** needs doing and **how long** it takes. The **scheduler**, which is ordinary predictable code rather than AI, decides **when**, and it follows these rules every time:

- **A daily limit.** Focused work never goes over your daily maximum (6 hours by default, or whatever you tell the assistant), counting what's already booked.
- **Spread, don't cram.** Work is spread across the days before each deadline instead of piled on the first day.
- **Short sessions.** Each session is at most two hours, with a 15-minute break after it.
- **Lunch stays free.** Noon to 1 PM is never booked.
- **No double-booking.** Nothing is placed on top of an existing calendar entry.
- **Weekends last.** Saturdays and Sundays are filled only when the weekdays are full, and days you ask to keep free stay free.

Why keep the AI out of the timing? Language models, especially small local ones, are unreliable at date arithmetic. Splitting the job keeps the burnout rules dependable, and it gives the AI a simpler task to learn.

## 7. Team assignment with a burnout check

When a leader or sub-leader asks the assistant to assign a task, PlanMate checks the assignee's real calendar from today until the due date **before** assigning. The person counts as overloaded if any of these is true:

- a day in that period is already over their daily limit
- their planned work already fills 80% or more of their capacity for the period
- the due date itself is 80% or more full
- they already have 6 or more unfinished tasks due in the period

**If they have room,** the task is assigned immediately and appears in their Shared Tasks. From then on the leader can follow it on the **Assigned by you** board, the member is reminded the day before it's due, and the leader is notified the moment it's completed.

**If they're overloaded,** nothing is assigned yet. A **popup** opens for the leader with:

- the reasons, in plain words
- a day-by-day bar chart of that person's load against their daily limit
- **Change the handler:** one-click buttons for teammates with more room
- **Reschedule:** a suggested free day, or any date they pick
- **Assign anyway** and **Don't assign**

**The leader still decides.** This is advice, not a block. A new person or date is checked again, and they can also reply in chat ("give it to Devin instead", "make it due next Wednesday").

### Who can assign to whom

| Role | Can assign to |
| --- | --- |
| Team leader | Anyone |
| Sub-leader | Members |
| Member | Nobody; members receive tasks |

Members don't even see the **Assign** shortcut in the chat. The rule is enforced on the server, so it can't be bypassed from the browser. A member also can't delete a task a teammate assigned to them.

## 8. Safety and trust built in

- **Easy to change or undo:** plans go on the calendar at once, but one sentence reschedules them and "undo" removes them; work you've started on is never thrown away.
- **Review before sending:** a message to your leader is shown to you first and only sent when you press Send.
- **Advice, not control:** the workload check informs the leader and never overrides them.
- **Clarify instead of guessing:** when a removal is ambiguous, the assistant asks.
- **Private by default:** a closed group of known users, hashed passwords and sessions, and one-day sign-ins.
- **Forgiving of AI mistakes:** if the model returns something malformed, the app shows it as a normal chat message instead of crashing.

## 9. Bring-your-own AI model

PlanMate is built so that a teammate's own locally trained model can be plugged in later.

- The app talks to any **OpenAI-compatible** endpoint (Ollama, LM Studio, vLLM, llama.cpp, or a small custom server). Switching is a three-line config change.
- The model returns one small JSON object with an action (`propose`, `ask`, `confirm`, `cancel`, `update`, `assign`, `remove`, `chat`) and a reply.
- Until the real model is ready, a built-in **rule-based planner** follows the same contract, so the whole app can be demoed today. It also serves as a source of example training data.
- The full contract is in [LLM_INTEGRATION.md](LLM_INTEGRATION.md).

## 10. Under the hood

| Layer | Technology |
| --- | --- |
| Web framework | Next.js 16 (App Router, Server Components, Server Actions), React 19 |
| Database | PostgreSQL with Drizzle ORM and versioned migrations |
| Styling and UI | Tailwind CSS v4, shadcn/ui on Base UI, components from 21st.dev and libraries.dev, Light / Dark / System themes |
| Calendar | react-big-calendar with drag and drop |
| Validation | Zod, including tolerant parsing of AI output |
| Auth | Email + password (scrypt hashing), hashed server-side sessions, HttpOnly cookie |

**Design choices worth mentioning:**

- **Server-first.** Pages load their data on the server. Interactive pieces (chat, calendar, theme switch) are the only client code, and loading states use skeleton placeholders instead of "Loading…" text.
- **A distinctive look.** A drifting aurora background, frosted-glass panels, an animated assistant orb, and a custom prompt composer, so the app doesn't look like a generic template.
- **Desktop-focused.** The layout is designed for laptop and desktop screens.

## 11. A demo story (suggested flow)

1. **Sign in** as a member and show the empty, fresh chat.
2. **Plan a week:** "This week I have 2 assignments to complete, 3 papers to review, and I want to study ML." It's on the calendar straight away. (These match the example tasks the built-in planner understands; with the trained model, any wording works.) Point out the session split, the ML learning path, and that no day goes over the limit.
3. **Reschedule:** "Max 4 hours a day and keep Sunday free." The plan on the calendar rebuilds.
4. Show the calendar, with the urgent sessions in red and amber.
5. **Make progress:** tick a session on the calendar, or say "I finished paper 2", and show the Planning board update.
6. **Fix a mistake:** "Remove assignment 2." The assistant asks which one, with full names and dates. Then "remove assignment 2 set on Sat" removes exactly that one.
7. **Switch to a team leader** and assign a task to a busy teammate. The overload popup opens with the chart and alternatives. Click **Give to …** someone with room, or **Assign anyway** to show the leader stays in control.
8. **Sign in as that member** and show the task in **Shared Tasks** (if it's due tomorrow, the reminder pops up). Tick it on the calendar, then switch back to the leader: a "Task completed" notice appears and the **Assigned by you** board updates.
9. **Close on Reports:** time breakdown, boundary respected, overtime. "PlanMate doesn't just get the work done; it makes sure there's still a life around it."

## 12. Current limits and what's next

**Today:**

- The built-in rule-based planner understands only simple phrasings. The trained model will handle natural, varied language.
- The workload check counts hours from calendar sessions. Tasks with no scheduled sessions count only toward the open-task total.
- The theme choice is saved per browser, not per account.
- Removals and assignments can't be undone yet.

**Next:**

- Plug in the trained local model.
- Undo for removals and assignments.
- A notice when someone assigns you a task (today you see it in Shared Tasks).
- Email or phone notifications; today's notices appear only while the app is open.
- Learn each person's real pace from completed tasks to improve hour estimates.
- Team-wide workload view for leaders.
