// Enter yankı durulunca gider; sonuç yalnız PTY yazımını bildirir.
const SETTLE_MS = 500;
const MAX_SETTLE_MS = 8000;
const CHECK_MS = 1600;
const RETRIES = 2;

function createInjector({ write, lastOutputAt, awaitingApproval, generation = () => 0,
  inputPending = () => false, now = Date.now, later = setTimeout }) {
  const active = new Map();
  function inject(agent, text) {
    if (active.has(agent) || awaitingApproval(agent)) return Promise.resolve(false);
    return new Promise((resolve) => {
      const job = { generation: generation(agent), started: now(), finish };
      function finish(ok) {
        if (active.get(agent) === job) active.delete(agent);
        resolve(ok);
      }
      active.set(agent, job);
      const valid = () => active.get(agent) === job && generation(agent) === job.generation;
      const send = (data) => {
        if (!valid() || awaitingApproval(agent)) return false;
        try { return write(agent, data) !== false; } catch { return false; }
      };
      const pressEnter = (left) => {
        if (!send("\r")) { finish(false); return; }
        later(() => {
          if (!valid()) { finish(false); return; }
          if (left > 0 && !awaitingApproval(agent) && inputPending(agent, text, job.generation) === true) {
            pressEnter(left - 1);
          } else finish(true);
        }, CHECK_MS);
      };
      const settle = () => {
        if (!valid()) { finish(false); return; }
        if (now() - lastOutputAt(agent) >= SETTLE_MS || now() - job.started >= MAX_SETTLE_MS) {
          pressEnter(RETRIES);
        } else later(settle, 100);
      };
      if (!send(text)) { finish(false); return; }
      later(settle, SETTLE_MS);
    });
  }
  inject.cancel = (agent) => active.get(agent)?.finish(false);
  inject.busy = (agent) => active.has(agent);
  return inject;
}

module.exports = { createInjector, SETTLE_MS, MAX_SETTLE_MS, CHECK_MS, RETRIES };
