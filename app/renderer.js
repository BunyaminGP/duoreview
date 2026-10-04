const AGENTS = ["claude", "codex"];
const $ = (id) => document.getElementById(id);
const { t, setLang, STR } = window.I18N;
const views = {};
let isRunning = false;

for (const agent of AGENTS) {
  const term = new Terminal({
    fontFamily: "Cascadia Mono, Consolas, monospace", fontSize: 13, cursorBlink: true,
    theme: { background: "#0f1115" }, scrollback: 5000,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open($(`term-${agent}`));
  term.onData((data) => window.bridge.write(agent, data));
  views[agent] = { term, fit };
}

const fitAll = () => {
  for (const [agent, { term, fit }] of Object.entries(views)) {
    try { fit.fit(); window.bridge.resize(agent, term.cols, term.rows); } catch {}
  }
};
window.addEventListener("resize", fitAll);
new ResizeObserver(fitAll).observe(document.querySelector("main"));
requestAnimationFrame(fitAll);

// ---- dil -------------------------------------------------------------------
let curLang = "";
let lastState = null;
let lastBoard = null;

function applyStatic() {
  document.documentElement.lang = curLang;
  for (const e of document.querySelectorAll("[data-i18n]")) e.textContent = t(e.dataset.i18n);
  for (const e of document.querySelectorAll("[data-i18n-title]")) e.title = t(e.dataset.i18nTitle);
  for (const e of document.querySelectorAll("[data-i18n-placeholder]")) e.placeholder = t(e.dataset.i18nPlaceholder);
}
$("lang").replaceChildren(...Object.entries(STR).map(([code, s]) => {
  const o = document.createElement("option");
  o.value = code; o.textContent = s.langName;
  return o;
}));
$("lang").addEventListener("change", () => window.bridge.setLang($("lang").value));

// ---- ayarlar ---------------------------------------------------------------
const PROFILES = {
  ekonomik: { models: { claude: "sonnet", codex: "" }, efforts: { claude: "low", codex: "low" } },
  dengeli: { models: { claude: "sonnet", codex: "" }, efforts: { claude: "medium", codex: "medium" } },
  guclu: { models: { claude: "opus", codex: "" }, efforts: { claude: "high", codex: "high" } },
};
const currentCfg = () => ({
  captain: $("captain").value, reviewMode: $("mode").value, brief: $("brief").value.trim(),
  profile: $("profile").value,
  models: { claude: $("model-claude").value.trim(), codex: $("model-codex").value.trim() },
  efforts: { claude: $("effort-claude").value, codex: $("effort-codex").value },
});
const save = () => window.bridge.saveCfg(currentCfg());
for (const id of ["captain", "mode", "brief"]) $(id).addEventListener("change", save);

function applyProfile(name) {
  const p = PROFILES[name];
  if (!p) return;
  for (const a of AGENTS) { $("model-" + a).value = p.models[a]; $("effort-" + a).value = p.efforts[a]; }
}
$("profile").addEventListener("change", () => { applyProfile($("profile").value); save(); });
// Elle değiştirilirse profil "Özel" olur
for (const a of AGENTS) for (const id of ["model-" + a, "effort-" + a]) {
  $(id).addEventListener("change", () => { $("profile").value = "ozel"; save(); });
}
window.bridge.listModels().then((l) => {
  for (const a of AGENTS) {
    $("models-" + a).replaceChildren(...(l[a] || []).map((m) => { const o = document.createElement("option"); o.value = m; return o; }));
  }
});

window.bridge.onState((s) => {
  lastState = s;
  if (s.lang !== curLang) {
    curLang = s.lang;
    setLang(curLang);
    applyStatic();
    if (lastBoard) renderBoard(lastBoard);
  }
  $("lang").value = curLang;
  isRunning = s.running.length > 0;
  const dirs = s.recents.includes(s.projectDir) ? s.recents : [s.projectDir, ...s.recents];
  $("project").replaceChildren(...dirs.map((d) => {
    const o = document.createElement("option");
    o.value = d; o.textContent = d; o.selected = d === s.projectDir;
    return o;
  }));
  $("captain").value = s.cfg.captain;
  $("mode").value = s.cfg.reviewMode;
  $("brief").value = s.cfg.brief;
  $("profile").value = s.cfg.profile || "dengeli";
  for (const a of AGENTS) { $("model-" + a).value = s.cfg.models?.[a] ?? ""; $("effort-" + a).value = s.cfg.efforts?.[a] ?? ""; }
  const lock = ["project", "pick", "captain", "mode", "brief", "reset", "team", "profile"];
  for (const a of AGENTS) lock.push("model-" + a, "effort-" + a);
  for (const id of lock) $(id).disabled = isRunning;
  for (const a of AGENTS) setRole(a, s.cfg.captain);
});

function setRole(agent, captain) {
  $(`role-${agent}`).textContent = agent === captain ? t("roleCaptain") : t("roleWorker");
}

$("project").addEventListener("change", async () => {
  if (!(await window.bridge.setProject($("project").value))) alert(t("cantSwitch"));
});
$("pick").addEventListener("click", () => window.bridge.pickProject());
$("reset").addEventListener("click", async () => {
  if (confirm(t("confirmReset"))) await window.bridge.resetBoard();
});

// ---- terminaller -----------------------------------------------------------
window.bridge.onData(({ agent, data }) => views[agent].term.write(data));
window.bridge.onExit(({ agent, exitCode }) => {
  views[agent].term.write(`\r\n\x1b[90m${t("procClosed", { code: exitCode })}\x1b[0m\r\n`);
});

document.querySelectorAll("[data-start]").forEach((b) =>
  b.addEventListener("click", () => {
    const { term, fit } = views[b.dataset.start];
    fit.fit();
    window.bridge.start(b.dataset.start, term.cols, term.rows);
  }));
document.querySelectorAll("[data-kill]").forEach((b) =>
  b.addEventListener("click", () => window.bridge.kill(b.dataset.kill)));

$("team").addEventListener("click", () => {
  fitAll();
  const sizes = Object.fromEntries(AGENTS.map((a) => [a, { cols: views[a].term.cols, rows: views[a].term.rows }]));
  window.bridge.startTeam({ sizes, cfg: currentCfg() });
});

// ---- pano ------------------------------------------------------------------
const STATUS_KEY = { off: "stOff", busy: "stBusy", idle: "stIdle", approval: "stApproval", quota: "stQuota" };

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

let disputeSig = "";
function renderDecision(tasks) {
  const disputes = tasks.filter((x) => x.status === "DISPUTE");
  const sig = disputes.map((x) => x.id).join(",") + "|" + curLang;
  $("decision").hidden = !disputes.length;
  if (sig === disputeSig) return; // yazılan notu yenilemeyle silme
  disputeSig = sig;
  if (!disputes.length) return;
  const d = disputes[0];
  $("decision-title").textContent = "#" + d.id + " " + d.title + (disputes.length > 1 ? t("moreDisputes", { n: disputes.length - 1 }) : "");
  $("decision-note").value = "";
  for (const [btn, decision] of [["d-accept", "accept"], ["d-rereview", "rereview"], ["d-rework", "rework"]]) {
    $(btn).onclick = async () => {
      if (decision === "rework" && !$("decision-note").value.trim() && !confirm(t("confirmNoNote"))) return;
      await window.bridge.resolveTask(d.id, decision, $("decision-note").value);
    };
  }
}

// ---- kalan kullanım -------------------------------------------------------
let lastUsage = {};
const fmtRemain = (ms) => {
  if (ms <= 0) return t("now");
  const dk = Math.ceil(ms / 60000);
  if (dk >= 1440) return t("dayHour", { d: Math.floor(dk / 1440), h: Math.floor((dk % 1440) / 60) });
  if (dk >= 60) return t("hourMin", { h: Math.floor(dk / 60), m: dk % 60 });
  return t("min", { m: dk });
};
function meter(label, w) {
  const box = el("span", "meter");
  const track = el("span", "track");
  const fill = el("span", "fill" + (w.pct >= 85 ? " bad" : w.pct >= 60 ? " warn" : ""));
  fill.style.width = Math.min(100, w.pct) + "%";
  track.append(fill);
  const left = w.resetsAt ? fmtRemain(w.resetsAt - Date.now()) : t("renewed");
  box.append(el("span", "", label), track, el("span", "val", t("pct", { n: w.pct }) + " · " + left));
  return box;
}
function renderUsage() {
  for (const a of AGENTS) {
    const u = lastUsage[a], box = $("usage-" + a);
    if (!u || !u.ok) { box.replaceChildren(el("span", "none", u?.note || t("usageWaiting"))); box.title = ""; continue; }
    const parts = [];
    if (u.five) parts.push(meter(t("w5h"), u.five));
    if (u.week) parts.push(meter(t("wWeek"), u.week));
    box.replaceChildren(...parts);
    const ago = u.asOf ? t("minAgo", { n: Math.round((Date.now() - u.asOf) / 60000) }) : "";
    box.title = [u.plan && t("planLabel", { plan: u.plan }), u.model, u.ctx != null && t("ctx", { n: u.ctx }), ago].filter(Boolean).join(" · ");
  }
}
setInterval(renderUsage, 15000); // geri sayım dakikada bir değişir; board gelince de yenilenir

function renderBoard({ tasks, events, agents, usage }) {
  lastUsage = usage || {};
  renderUsage();
  renderDecision(tasks);
  for (const a of AGENTS) {
    const { status, flow } = agents[a];
    $(`dot-${a}`).className = `dot ${status}`;
    const st = $(`state-${a}`);
    const flowText = flow ? " · " + (STR[curLang]["f" + flow] ? t("f" + flow) : flow) : "";
    st.textContent = status === "off" ? t("stOff") : `${t(STATUS_KEY[status])}${flowText}`;
    st.className = `state ${status === "approval" ? "approval" : status === "quota" ? "quota" : ""}`;
    if (status === "quota") st.textContent = t("quotaFullWhy", { why: agents[a].why });
  }

  const done = tasks.filter((x) => x.status === "DONE").length;
  $("summary").textContent = tasks.length ? t("doneOf", { done, total: tasks.length }) : "";
  const list = $("tasks");
  list.replaceChildren(...(tasks.length ? tasks.map((x) => {
    const li = el("li");
    li.append(el("span", "id", `#${x.id}`), el("span", "", x.title));
    const meta = el("div", "meta");
    meta.append(el("span", `chip s-${x.status}`, STR[curLang]["s" + x.status] ? t("s" + x.status) : x.status));
    const who = x.owner || x.assignee;
    if (who) meta.append(el("span", "", who));
    if (x.rounds) meta.append(el("span", "", t("round", { n: x.rounds })));
    li.append(meta);
    return li;
  }) : [el("li", "empty", t("emptyBoard"))]));

  const log = $("events");
  const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 20;
  log.replaceChildren(...events.map((e) => {
    const li = el("li");
    li.append(el("span", "who", e.actor + " "), document.createTextNode(e.text));
    return li;
  }));
  if (stick) log.scrollTop = log.scrollHeight;
}

window.bridge.onBoard((b) => { lastBoard = b; renderBoard(b); });
