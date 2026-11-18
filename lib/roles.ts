export const ROLES = ["leader", "sub-leader", "member"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  leader: "Team leader",
  "sub-leader": "Sub-leader",
  member: "Member",
};

/**
 * Who may assign a task to whom:
 *  - a team leader can assign to anyone
 *  - a sub-leader can assign to members
 *  - a member cannot assign tasks, only receive them
 * Nobody assigns tasks to themselves; their own work goes through the planner.
 */
/** Whether this role can assign tasks at all. Members cannot. */
export const canAssign = (role: Role) => role !== "member";

export const canAssignTo =(assigner: Role, assignee: Role) =>
  assigner === "leader" || (assigner === "sub-leader" && assignee === "member");
