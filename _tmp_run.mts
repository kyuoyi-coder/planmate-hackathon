import { runPlanner } from "./_tmp_provider.mts";
const ctx: any = { now: "2026-11-18T10:00", userName: "Hana Kim", prefs: { dayStart: 540, dayEnd: 1080, maxWorkMinutes: 360 }, tasks: [], teammates: [], heldAssignments: [] };
const texts = [
  "In the next 3 days I have 3 papers to review, 2 assignments, gym for 1 hour, and have to complete ML course. Also suggest me some other activities I can do in other free times",
  "In the next 5 days I have 3 papers to review, 2 assignments, gym for 1 hour, and have to complete ML course. Also suggest me some other activities I can do in other free times",
  "This week I have 2 papers to review and gym for 1 hour",
];
for (const text of texts) for (let i = 1; i <= 2; i++) {
  const t0 = Date.now();
  const o: any = await runPlanner([{ role: "user", content: text }], ctx);
  console.log(`${text.slice(0, 28)}… run ${i} [${((Date.now() - t0) / 1000).toFixed(1)}s] ${o.action}: ${o.plan ? o.plan.items.map((it: any) => it.title).join(", ") : o.reply.slice(0, 140)}`);
}
