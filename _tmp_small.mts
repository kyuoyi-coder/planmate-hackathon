const SYS_LIST = `Extract the to-do items from the user's message. Reply with JSON only, like the examples. Never ask questions.

Message: This week I need to read 2 reports, write 1 essay and do yoga for 45 minutes. Any ideas for my free time?
JSON: {"items":[{"title":"Read report","count":2,"category":"work"},{"title":"Write essay","count":1,"category":"study"},{"title":"Yoga 45 minutes","count":1,"category":"exercise"}],"ideas":["Take a walk outside","Cook something new","Call a friend"]}

Message: by friday finish the slides and study statistics
JSON: {"items":[{"title":"Finish the slides","count":1,"category":"work"},{"title":"Study statistics","count":1,"category":"study"}],"ideas":[]}`;
const SYS_STEPS = `Split the task into work sessions of at most 2 hours with honest hour estimates. Reply with JSON only, like the examples. Never ask questions; assume a typical version of the task.

Task: Write essay
JSON: {"steps":[{"title":"Outline","hours":1},{"title":"Write the draft","hours":2},{"title":"Edit and finish","hours":1}]}

Task: Study statistics
JSON: {"steps":[{"title":"Descriptive statistics","hours":1.5},{"title":"Probability basics","hours":2},{"title":"Hypothesis testing","hours":2},{"title":"Practice problems","hours":1.5}]}

Task: Yoga 45 minutes
JSON: {"steps":[{"title":"Yoga","hours":0.75}]}`;
const call = async (system: string, message: string) => {
  const t0 = Date.now();
  const r = await fetch("http://10.131.151.20:8000/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ system, message, thread_id: "planmate-fs-" + Math.random().toString(36).slice(2) }) });
  const d: any = await r.json(); return `[${((Date.now() - t0) / 1000).toFixed(1)}s] ${String(d.reply).replace(/\s+/g, " ")}`;
};
for (let i = 0; i < 3; i++) console.log("LIST", await call(SYS_LIST, "Message: This week I have 3 papers to review, 2 assignments, gym for 1 hour, and have to complete ML course. Also suggest me some other activities I can do in other free times\nJSON:"));
for (const t of ["Review paper", "Assignment", "Gym 1 hour", "Complete ML course"]) for (let i = 0; i < 2; i++) console.log("STEPS", t, await call(SYS_STEPS, `Task: ${t}\nJSON:`));
