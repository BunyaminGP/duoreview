const AGENTS = ["claude", "codex", "gemini"];
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
  ekonomik: { models: { claude: "sonnet", codex: "", gemini: "" }, efforts: { claude: "low", codex: "low", gemini: "low" } },
  dengeli: { models: { claude: "sonnet", codex: "", gemini: "" }, efforts: { claude: "medium", codex: "medium", gemini: "medium" } },
  guclu: { models: { claude: "opus", codex: "", gemini: "" }, efforts: { claude: "high", codex: "high", gemini: "high" } },
};
// Model seçimi: tam liste bir <select> içinde durur; listede olmayan ad "elle yaz" ile girilir.
const CUSTOM = "__custom__";
const FALLBACK_EFFORTS = ["low", "medium", "high", "xhigh"];
let modelLists = Object.fromEntries(AGENTS.map((a) => [a, { models: [], current: "" }]));
const option = (value, text) => { const o = document.createElement("option"); o.value = value; o.textContent = text; return o; };
const modelOf = (a) => ($("model-" + a).value === CUSTOM ? $(`model-${a}-custom`).value.trim() : $("model-" + a).value);

function fillEfforts(a, value = $("effort-" + a).value) {
  const { models, current } = modelLists[a];
  const m = models.find((x) => x.id === (modelOf(a) || current));
  const efforts = m?.efforts?.length ? m.efforts : FALLBACK_EFFORTS;
  if (value && !efforts.includes(value)) value = "";
  $("effort-" + a).replaceChildren(option("", t("effortDefault")), ...efforts.map((e) => option(e, e)));
  $("effort-" + a).value = value;
}
function fillModels(a, value) {
  const { models, current } = modelLists[a];
  const opts = [option("", current ? t("modelDefaultIs", { model: current }) : t("modelDefault"))];
  for (const m of models) opts.push(option(m.id, `${m.alias ? t("modelLatest", { name: m.label }) : m.label}  ·  ${m.id}`));
  if (value && !models.some((m) => m.id === value)) opts.push(option(value, value));
  opts.push(option(CUSTOM, t("modelCustom")));
  $("model-" + a).replaceChildren(...opts);
  $("model-" + a).value = value;
  $(`model-${a}-custom`).hidden = true;
}

const team = () => $("teamsel").value.split(",");
const currentCfg = () => ({
  team: team(), captain: $("captain").value, reviewMode: $("mode").value, kickoff: $("kickoff").value, brief: $("brief").value.trim(),
  profile: $("profile").value,
  models: Object.fromEntries(AGENTS.map((a) => [a, modelOf(a)])),
  efforts: Object.fromEntries(AGENTS.map((a) => [a, $("effort-" + a).value])),
});
const save = () => window.bridge.saveCfg(currentCfg());
for (const id of ["captain", "mode", "kickoff", "brief"]) $(id).addEventListener("change", save);

// Takımda olmayan ajanın terminali ve model ayarı gizlenir; kalan terminaller genişler. Kaptan takımdan biri olmalı.
function applyTeam() {
  const members = team();
  for (const a of AGENTS) {
    $("pane-" + a).hidden = $("grp-" + a).hidden = !members.includes(a);
    $("captain").querySelector(`option[value="${a}"]`).disabled = !members.includes(a);
  }
  if (!members.includes($("captain").value)) $("captain").value = members[0];
  document.querySelector("main").style.gridTemplateColumns = `repeat(${members.length}, minmax(0, 1fr)) 340px`;
  for (const a of AGENTS) setRole(a, $("captain").value);
  requestAnimationFrame(fitAll);
}
$("teamsel").addEventListener("change", () => { applyTeam(); save(); });

function applyProfile(name) {
  const p = PROFILES[name];
  if (!p) return;
  for (const a of AGENTS) { fillModels(a, p.models[a]); fillEfforts(a, p.efforts[a]); }
}
$("profile").addEventListener("change", () => { applyProfile($("profile").value); save(); });
// Elle değiştirilirse profil "Özel" olur
const custom = () => { $("profile").value = "ozel"; save(); };
for (const a of AGENTS) {
  const input = $(`model-${a}-custom`);
  $("model-" + a).addEventListener("change", () => {
    if ($("model-" + a).value === CUSTOM) { input.hidden = false; input.value = ""; input.focus(); return; }
    input.hidden = true;
    fillEfforts(a);
    custom();
  });
  input.addEventListener("change", () => { fillModels(a, input.value.trim()); fillEfforts(a); custom(); });
  $("effort-" + a).addEventListener("change", custom);
}
window.bridge.listModels().then((l) => {
  modelLists = l;
  for (const a of AGENTS) { fillModels(a, modelOf(a)); fillEfforts(a); }
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
  $("teamsel").value = s.cfg.team.join(",");
  $("captain").value = s.cfg.captain;
  applyTeam();
  $("mode").value = s.cfg.reviewMode;
  $("kickoff").value = s.cfg.kickoff;
  $("brief").value = s.cfg.brief;
  $("profile").value = s.cfg.profile || "dengeli";
  for (const a of AGENTS) { fillModels(a, s.cfg.models?.[a] ?? ""); fillEfforts(a, s.cfg.efforts?.[a] ?? ""); }
  const lock = ["project", "pick", "teamsel", "captain", "mode", "kickoff", "brief", "reset", "team", "profile"];
  for (const a of AGENTS) lock.push("model-" + a, `model-${a}-custom`, "effort-" + a);
  for (const id of lock) $(id).disabled = isRunning;
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
  const sizes = Object.fromEntries(team().map((a) => [a, { cols: views[a].term.cols, rows: views[a].term.rows }]));
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
let lastUsage = {}, lastMeta = {};
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
    // MCP sunucusunun saydığı araç çağrıları ve karakterler (token değil)
    const n = lastMeta["calls:" + a];
    const calls = n ? [el("span", "", t("callsChars", { n, up: lastMeta["chars_in:" + a], down: lastMeta["chars_out:" + a] }))] : [];
    if (!u || !u.ok) { box.replaceChildren(el("span", "none", u?.note || t("usageWaiting")), ...calls); box.title = ""; continue; }
    const parts = [];
    if (u.five) parts.push(meter(t("w5h"), u.five));
    if (u.week) parts.push(meter(t("wWeek"), u.week));
    box.replaceChildren(...parts, ...calls);
    const ago = u.asOf ? t("minAgo", { n: Math.round((Date.now() - u.asOf) / 60000) }) : "";
    box.title = [u.plan && t("planLabel", { plan: u.plan }), u.model, u.ctx != null && t("ctx", { n: u.ctx }), ago].filter(Boolean).join(" · ");
  }
}
setInterval(renderUsage, 15000); // geri sayım dakikada bir değişir; board gelince de yenilenir

// ---- notlar ve tartışma ----------------------------------------------------
const label = (k) => (STR[curLang]["k_" + k] ? t("k_" + k) : k);
const chip = (k) => el("span", `chip o-${k}`, label(k));
let talkSig = "";

function showTab(talk) {
  $("tab-talk").classList.toggle("on", talk);
  $("tab-board").classList.toggle("on", !talk);
  $("talk-list").hidden = !talk;
  $("view-board").hidden = talk;
}
$("tab-board").addEventListener("click", () => showTab(false));
$("tab-talk").addEventListener("click", () => showTab(true));
$("reader-close").addEventListener("click", () => { $("reader").hidden = true; fitAll(); });
$("talk-export").addEventListener("click", () => window.bridge.exportTalk());

async function openReader(anchor) {
  const { notes, threads } = await window.bridge.talk();
  const body = $("reader-body");
  const keep = $("reader").hidden ? 0 : body.scrollTop;
  const doc = (n) => {
    const d = el("div", "doc"); d.id = "note-" + n.id;
    const h = el("h3");
    h.append(el("span", "who-" + n.author, n.author), el("span", "", n.title || label(n.kind)));
    d.append(h, el("p", "text", n.text));
    return d;
  };
  const kick = notes.filter((n) => n.kind === "kickoff"), rest = notes.filter((n) => n.kind !== "kickoff");
  const parts = [];
  // Açılış incelemeleri yan yana (her turda takımdaki ajan sayısı kadar): farklar göz gezdirerek görülsün
  const per = new Set(kick.map((n) => n.author)).size;
  for (let i = 0; i < kick.length; i += per) {
    const pair = el("div", "pair");
    pair.style.gridTemplateColumns = `repeat(${per}, minmax(0, 1fr))`;
    pair.append(...kick.slice(i, i + per).map(doc));
    parts.push(pair);
  }
  parts.push(...rest.map(doc));
  for (const th of threads) {
    const box = el("div", "thread"); box.id = "thread-" + th.id;
    const h = el("h3");
    h.append(el("span", "", `#${th.id} ${th.topic}`), chip(th.outcome ?? th.status));
    box.append(h);
    if (th.outcome === "split") box.append(el("p", "hint", t("splitHint")));
    for (const p of th.posts) {
      const post = el("div", "post " + p.author);
      const by = el("div", "by");
      by.append(el("b", "who-" + p.author, p.author), document.createTextNode(` · ${label(p.stance)} · ${p.created_at}`));
      post.append(by, el("p", "text", p.text));
      box.append(post);
    }
    parts.push(box);
  }
  body.replaceChildren(...(parts.length ? parts : [el("p", "empty", t("talkEmpty"))]));
  $("reader").hidden = false;
  if (anchor) document.getElementById(anchor)?.scrollIntoView(); else body.scrollTop = keep;
}

function renderTalk(notes, threads) {
  const open = threads.filter((x) => x.status === "OPEN").length;
  $("talk-count").textContent = open ? `(${open})` : "";
  const sig = JSON.stringify([notes, threads, curLang]);
  if (sig === talkSig) return;
  talkSig = sig;
  const item = (anchor, who, title, meta) => {
    const li = el("li");
    li.append(el("span", "who-" + who, who + " "), document.createTextNode(title));
    const m = el("div", "meta"); m.append(...meta); li.append(m);
    li.addEventListener("click", () => openReader(anchor));
    return li;
  };
  const rows = [];
  if (notes.length) rows.push(el("li", "head", t("talkNotes")));
  rows.push(...notes.map((n) => item("note-" + n.id, n.author, n.title || label(n.kind), [el("span", "", t("nChars", { n: n.size }))])));
  if (threads.length) rows.push(el("li", "head", t("talkThreads")));
  rows.push(...threads.map((x) => item("thread-" + x.id, "", `#${x.id} ${x.topic}`,
    [chip(x.outcome ?? x.status), el("span", "", label(x.kind)), el("span", "", t("nPosts", { n: x.posts }))])));
  $("talk-list").replaceChildren(...(rows.length ? rows : [el("li", "empty", t("talkEmpty"))]));
  // Açık okuma görünümü yeni not ya da mesaj gelince kendini yeniler
  if (!$("reader").hidden) openReader();
}

function renderBoard({ tasks, events, agents, usage, meta: counters = {}, notes = [], threads = [] }) {
  lastUsage = usage || {};
  lastMeta = counters;
  renderUsage();
  renderTalk(notes, threads);
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
    if (x.depends_on.length) meta.append(el("span", "", "← " + x.depends_on.map((d) => "#" + d).join(" ")));
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
