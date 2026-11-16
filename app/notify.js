function createNotifier(show) {
  let previous = new Set(), project;
  return ({ agents = {}, tasks = [] }, { focused, language, projectDir }) => {
    if (project !== projectDir) { previous = new Set(); project = projectDir; }
    const pending = new Map();
    const tr = language === "tr";
    for (const [agent, state] of Object.entries(agents)) {
      if (state.status === "approval") pending.set(`agent:${agent}`, tr ? `${agent} onayınızı bekliyor.` : `${agent} is waiting for your approval.`);
    }
    for (const task of tasks) {
      if (task.status === "DISPUTE") pending.set(`task:${task.id}`, tr ? `#${task.id} kararınızı bekliyor: ${task.title}` : `#${task.id} needs your decision: ${task.title}`);
    }
    const fresh = [...pending].filter(([key]) => !previous.has(key));
    previous = new Set(pending.keys());
    if (!focused) for (const [, body] of fresh) show({ title: "DuoReview", body });
  };
}

module.exports = { createNotifier };
