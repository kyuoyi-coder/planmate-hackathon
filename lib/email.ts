import "server-only";
import type { EmailDraft } from "@/lib/planner/types";
import { formatDay } from "@/lib/workload";

/**
 * The message a user sends to whoever assigned them a task when they can't
 * finish it on time. PlanMate doesn't send email itself: the user reviews
 * this draft, and "Send" records it in PlanMate and opens it in their own
 * email app through a mailto: link (see lib/mailto.ts).
 */
export function composeCannotFinishEmail(input: {
  senderName: string;
  task: { id: string; title: string; dueDate: string };
  to: { id: string; name: string; email: string };
  reason: string;
}): EmailDraft {
  const { senderName, task, to, reason } = input;
  const due = formatDay(task.dueDate);
  return {
    taskId: task.id,
    taskTitle: task.title,
    dueDate: task.dueDate,
    toId: to.id,
    toName: to.name,
    toEmail: to.email,
    subject: `Can't finish "${task.title}" by ${due}`,
    body: [
      `Hi ${to.name.split(" ")[0]},`,
      "",
      `I'm sorry, but I won't be able to finish "${task.title}" by its deadline (${due}).`,
      "",
      `Reason: ${reason}`,
      "",
      "Could we agree on a new deadline, or hand part of it to someone else?",
      "",
      "Thanks,",
      senderName,
    ].join("\n"),
    reason,
  };
}
