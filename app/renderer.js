const AGENTS = ["claude", "codex", "gemini"];
const $ = (id) => document.getElementById(id);
const { t, setLang, STR } = window.I18N;
const {
  handleTerminalKey,
  createPasteTargetManager,
  createComposerController,
  createHoldController,
  getLifecycleButtonState,
  triggerAgentStart,
  formatLifecycleStatus,
  resetTerminalModes,
} = window.InputLib || (typeof require !== "undefined" ? require("./input.js") : {});
const {
  MIN_PANE_PX = 240,
  DEFAULT_SIDE_PX = 340,
  clampSide = (n) => Math.min(600, Math.max(260, Math.round(Number(n) || 340))),
  clampFont = (n) => Math.min(24, Math.max(9, Math.round(Number(n) || 13))),
  clampComposer = (n) => Math.max(40, Math.round(Number(n) || 52)),
  normalizeRatios = (c) => c,
  equalRatios = (m, c) => c,
  resizePair = (c) => c,
  normalizeUi = (u) => u || { cols: { claude: 1 / 3, codex: 1 / 3, gemini: 1 / 3 }, side: 340, font: { claude: 13, codex: 13, gemini: 13 }, composer: { claude: 52, codex: 52, gemini: 52 }, max: null, advanced: false },
  createResizeFilter = (fn) => ({ send: fn, reset: () => {} }),
} = window.LayoutLib || (typeof require !== "undefined" ? require("./layout.js") : {});
const {
  buildTaskViewModel,
  createBoardListGuard,
} = window.TaskViewLib || (typeof require !== "undefined" ? require("./taskview.js") : {});

const readClipboard = async () => {
  try { return (await window.bridge?.readClipboard?.()) || ""; } catch { return ""; }
};

const writeClipboard = async (text) => {
  try { return (await window.bridge?.writeClipboard?.(text)) ?? false; } catch { return false; }
};

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

  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown") return true;
    const hasSelection = term.hasSelection();
    const selectedText = term.getSelection();

    if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === "c" || e.key === "C")) {
      if (hasSelection) {
        writeClipboard(selectedText);
        return false;
      }
      return true;
    }

    const isPaste = (e.ctrlKey && (e.key === "v" || e.key === "V")) ||
                    (e.shiftKey && (e.key === "Insert" || e.key === "paste"));
    if (isPaste && !e.altKey) {
      e.preventDefault();
      readClipboard().then((clipText) => {
        const res = handleTerminalKey ? handleTerminalKey(e, { hasSelection: false, clipboardText: clipText }) : { handled: false };
        if (res.action === "paste") {
          views[agent].term.paste(res.text);
        } else if (res.action === "image-passthrough") {
          window.bridge.write(agent, "\x16");
        }
      });
      return false;
    }
    return true;
  });

  views[agent] = { term, fit };
}

// ---- bağlam menüsü & composer ----------------------------------------------
let activeTargetAgent = "claude";
let activeTargetTextarea = null;
const ctxMenu = $("context-menu");
const ctxCopy = $("ctx-copy");
const ctxPaste = $("ctx-paste");

function hideContextMenu() {
  if (ctxMenu) ctxMenu.hidden = true;
}
document.addEventListener("click", hideContextMenu);
window.addEventListener("blur", hideContextMenu);

const pasteTargetManager = createPasteTargetManager ? createPasteTargetManager({
  readClipboard,
  pasteToAgent: async (agent, text) => {
    if (activeTargetTextarea && activeTargetAgent === agent) {
      const ta = activeTargetTextarea;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const val = ta.value;
      ta.value = val.slice(0, start) + text + val.slice(end);
      ta.selectionStart = ta.selectionEnd = start + text.length;
      composerControllers[agent]?.setDraft(ta.value);
    } else {
      views[agent]?.term.paste(text);
    }
  },
}) : null;

if (ctxCopy) {
  ctxCopy.addEventListener("click", async () => {
    hideContextMenu();
    const sel = activeTargetTextarea
      ? activeTargetTextarea.value.slice(activeTargetTextarea.selectionStart, activeTargetTextarea.selectionEnd)
      : (views[activeTargetAgent]?.term.getSelection() || window.getSelection()?.toString() || "");
    if (sel) await writeClipboard(sel);
  });
}

if (ctxPaste) {
  ctxPaste.addEventListener("click", async () => {
    hideContextMenu();
    if (pasteTargetManager) {
      await pasteTargetManager.triggerPaste(activeTargetAgent);
    } else {
      const text = await readClipboard();
      if (text) views[activeTargetAgent]?.term.paste(text);
    }
  });
}

function openContextMenu(e, agent, textarea = null) {
  e.preventDefault();
  activeTargetAgent = agent;
  activeTargetTextarea = textarea;
  const hasSel = textarea
    ? (textarea.selectionStart !== textarea.selectionEnd)
    : Boolean(views[agent]?.term.hasSelection() || window.getSelection()?.toString());
  if (ctxCopy) ctxCopy.disabled = !hasSel;
  if (ctxMenu) {
    ctxMenu.style.left = `${Math.min(e.clientX, window.innerWidth - 130)}px`;
    ctxMenu.style.top = `${Math.min(e.clientY, window.innerHeight - 80)}px`;
    ctxMenu.hidden = false;
  }
}

for (const a of AGENTS) {
  $(`term-${a}`)?.addEventListener("contextmenu", (e) => openContextMenu(e, a, null));
  $(`input-${a}`)?.addEventListener("contextmenu", (e) => openContextMenu(e, a, $(`input-${a}`)));
}

const holdCtrl = createHoldController ? createHoldController({
  setHoldFn: (agent, held) => {
    if (window.bridge?.hold) {
      try { window.bridge.hold(agent, held); } catch {}
    }
  },
}) : null;

const composerControllers = {};
for (const a of AGENTS) {
  const input = $(`input-${a}`);
  const sendBtn = $(`send-${a}`);
  const statusSpan = $(`composer-status-${a}`);

  const ctrl = createComposerController ? createComposerController({
    agent: a,
    sendFn: async (agentId, text) => {
      return await window.bridge.send(agentId, text);
    },
    onStateChange: ({ draft, sending, error }) => {
      if (input && input.value !== draft) input.value = draft;
      if (sendBtn) sendBtn.disabled = sending;
      if (statusSpan) statusSpan.textContent = error ? t("sendError", { err: error }) : "";
    },
  }) : { send: async () => {}, setDraft: () => {}, isSending: () => false };

  composerControllers[a] = ctrl;

  if (input) {
    input.addEventListener("focus", () => holdCtrl?.onFocus(a, input.value));
    input.addEventListener("input", () => {
      holdCtrl?.onInput(a, input.value, true);
      ctrl.setDraft(input.value);
    });
    input.addEventListener("blur", () => holdCtrl?.onBlur(a));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        ctrl.send();
      }
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener("click", () => ctrl.send());
  }
}

let uiState = normalizeUi();
let saveUiTimer = null;
function scheduleSaveUi() {
  clearTimeout(saveUiTimer);
  saveUiTimer = setTimeout(() => {
    saveUiTimer = null;
    try { window.bridge?.saveUi?.(uiState); } catch {}
  }, 300);
}

const resizeFilter = createResizeFilter((agent, cols, rows) => window.bridge.resize(agent, cols, rows));
let fitRaf = 0;
const visibleAgents = () => {
  const members = $("teamsel") ? $("teamsel").value.split(",") : AGENTS;
  return uiState.max && members.includes(uiState.max) ? [uiState.max] : members;
};
const fitNow = () => {
  if (fitRaf) { cancelAnimationFrame(fitRaf); fitRaf = 0; }
  for (const agent of visibleAgents()) {
    const v = views[agent];
    if (!v) continue;
    try {
      v.fit.fit();
      resizeFilter.send(agent, v.term.cols, v.term.rows);
    } catch {}
  }
};
const fitAll = () => {
  if (!fitRaf) fitRaf = requestAnimationFrame(fitNow);
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
  team: team(), captain: $("captain").value, reviewMode: $("mode").value, kickoff: $("kickoff").value,
  subagents: $("subagents") ? $("subagents").value : "research",
  brief: $("brief").value.trim(),
  verify: $("verify").value.trim(),
  profile: $("profile").value,
  models: Object.fromEntries(AGENTS.map((a) => [a, modelOf(a)])),
  efforts: Object.fromEntries(AGENTS.map((a) => [a, $("effort-" + a).value])),
});
const save = () => window.bridge.saveCfg(currentCfg());
for (const id of ["captain", "mode", "kickoff", "subagents", "brief", "verify"]) $(id)?.addEventListener("change", save);

function applyAdvanced() {
  const adv = Boolean(uiState.advanced);
  if ($("advanced-panel")) $("advanced-panel").hidden = !adv;
  if ($("advanced-toggle")) $("advanced-toggle").classList.toggle("active", adv);
}
$("advanced-toggle")?.addEventListener("click", () => {
  uiState.advanced = !uiState.advanced;
  applyAdvanced();
  fitAll();
  scheduleSaveUi();
});

function applyLayout() {
  const members = team();
  if (uiState.max && !members.includes(uiState.max)) uiState.max = null;
  const vis = visibleAgents();
  for (const a of AGENTS) {
    $("pane-" + a).hidden = !vis.includes(a);
    $("grp-" + a).hidden = !members.includes(a);
    const maxBtn = $("max-" + a);
    if (maxBtn) {
      const isMax = uiState.max === a;
      maxBtn.textContent = t(isMax ? "paneRestore" : "paneMax");
      maxBtn.title = t(isMax ? "paneRestoreTitle" : "paneMaxTitle");
      maxBtn.classList.toggle("active", isMax);
    }
    const f = clampFont(uiState.font?.[a]);
    uiState.font[a] = f;
    if (views[a]?.term && views[a].term.options.fontSize !== f) views[a].term.options.fontSize = f;
    const input = $("input-" + a), pane = $("pane-" + a);
    if (input) {
      const ph = pane?.clientHeight || 0;
      if (ph > 0) input.style.maxHeight = `${Math.max(40, Math.floor(ph * 0.5))}px`;
      if (uiState.composer?.[a]) input.style.height = `${clampComposer(uiState.composer[a], ph)}px`;
    }
  }
  const s1 = $("split-1"), s2 = $("split-2");
  if (s1 && s2) {
    if (vis.length <= 1) {
      s1.hidden = true;
      s2.hidden = true;
    } else if (vis.length === 2) {
      if (vis[0] === "claude") {
        s1.hidden = false; s1.dataset.left = vis[0]; s1.dataset.right = vis[1];
        s2.hidden = true;
      } else {
        s1.hidden = true;
        s2.hidden = false; s2.dataset.left = vis[0]; s2.dataset.right = vis[1];
      }
    } else {
      s1.hidden = false; s1.dataset.left = "claude"; s1.dataset.right = "codex";
      s2.hidden = false; s2.dataset.left = "codex"; s2.dataset.right = "gemini";
    }
  }
  uiState.side = clampSide(uiState.side);
  document.documentElement.style.setProperty("--side", `${uiState.side}px`);
  applyAdvanced();
  const norm = normalizeRatios(uiState.cols, vis);
  const paneCols = vis.map((a) => `minmax(${MIN_PANE_PX}px, ${(norm[a] * 1000).toFixed(1)}fr)`).join(" 5px ");
  document.querySelector("main").style.gridTemplateColumns = `${paneCols} 5px var(--side)`;
  fitAll();
}

// Takımda olmayan ajanın terminali ve model ayarı gizlenir; kalan terminaller genişler. Kaptan takımdan biri olmalı.
function applyTeam() {
  const members = team();
  for (const a of AGENTS) {
    $("captain").querySelector(`option[value="${a}"]`).disabled = !members.includes(a);
  }
  if (!members.includes($("captain").value)) $("captain").value = members[0];
  for (const a of AGENTS) setRole(a, $("captain").value);
  applyLayout();
}
$("teamsel").addEventListener("change", () => { applyTeam(); save(); });

function setAgentFont(agent, nextSize) {
  const size = clampFont(nextSize);
  if (uiState.font[agent] === size && views[agent]?.term.options.fontSize === size) return;
  uiState.font[agent] = size;
  if (views[agent]?.term) views[agent].term.options.fontSize = size;
  fitAll();
  scheduleSaveUi();
}

document.querySelectorAll("[data-font-down]").forEach((b) =>
  b.addEventListener("click", () => setAgentFont(b.dataset.fontDown, (uiState.font[b.dataset.fontDown] || 13) - 1)));
document.querySelectorAll("[data-font-up]").forEach((b) =>
  b.addEventListener("click", () => setAgentFont(b.dataset.fontUp, (uiState.font[b.dataset.fontUp] || 13) + 1)));
document.querySelectorAll("[data-max]").forEach((b) =>
  b.addEventListener("click", () => {
    const a = b.dataset.max;
    uiState.max = uiState.max === a ? null : a;
    applyLayout();
    scheduleSaveUi();
  }));

for (const a of AGENTS) {
  $(`term-${a}`)?.addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1 : e.deltaY > 0 ? -1 : 0;
    if (delta) setAgentFont(a, (uiState.font[a] || 13) + delta);
  }, { passive: false });

  const input = $(`input-${a}`);
  if (input) {
    const syncComposerHeight = () => {
      if (input.offsetHeight <= 0) return;
      const h = clampComposer(input.offsetHeight, $(`pane-${a}`)?.clientHeight || 0);
      if (h !== uiState.composer[a]) {
        uiState.composer[a] = h;
        input.style.height = `${h}px`;
        fitAll();
        scheduleSaveUi();
      }
    };
    input.addEventListener("mousedown", () => {
      window.addEventListener("mouseup", syncComposerHeight, { once: true });
    });
  }
}

document.querySelectorAll(".splitter").forEach((sp) => {
  sp.addEventListener("dblclick", () => {
    if (sp.dataset.split === "side") {
      uiState.side = DEFAULT_SIDE_PX;
    } else {
      uiState.cols = equalRatios(visibleAgents(), uiState.cols);
    }
    applyLayout();
    scheduleSaveUi();
  });

  sp.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const isSide = sp.dataset.split === "side";
    const startX = e.clientX;
    const startSide = uiState.side;
    const startCols = { ...uiState.cols };
    const left = sp.dataset.left;
    const right = sp.dataset.right;
    const vis = visibleAgents();
    const totalPx = vis.reduce((sum, a) => sum + ($("pane-" + a)?.getBoundingClientRect().width || 0), 0);

    sp.classList.add("dragging");
    document.body.classList.add("resizing");

    const onMove = (ev) => {
      if (isSide) {
        uiState.side = clampSide(startSide + (startX - ev.clientX));
      } else if (left && right && totalPx > 0) {
        uiState.cols = resizePair(startCols, vis, left, right, ev.clientX - startX, totalPx, MIN_PANE_PX);
      }
      applyLayout();
    };
    const onUp = () => {
      sp.classList.remove("dragging");
      document.body.classList.remove("resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      scheduleSaveUi();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
});

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
let preflightData = null;
Promise.resolve(window.bridge?.preflight?.())
  .then((pf) => {
    if (!pf || typeof pf !== "object") return;
    preflightData = pf;
    if (lastState) updateLifecycleUI(lastState);
    if (lastBoard) renderBoard(lastBoard);
  })
  .catch(() => {});

let modalResolve = null;
function closeModal(result) {
  const modal = $("modal");
  if (modal) modal.hidden = true;
  const res = modalResolve;
  modalResolve = null;
  if (res) res(Boolean(result));
}
$("modal-ok")?.addEventListener("click", () => closeModal(true));
$("modal-cancel")?.addEventListener("click", () => closeModal(false));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modalResolve) {
    e.preventDefault();
    closeModal(false);
  }
});
function showDialog(message, { alertOnly = false } = {}) {
  const modal = $("modal");
  if (!modal) return Promise.resolve(!alertOnly);
  if (modalResolve) closeModal(false);
  $("modal-msg").textContent = String(message || "");
  $("modal-cancel").hidden = Boolean(alertOnly);
  modal.hidden = false;
  $("modal-ok")?.focus();
  return new Promise((resolve) => { modalResolve = resolve; });
}

window.bridge.listModels().then((l) => {
  modelLists = l;
  for (const a of AGENTS) { fillModels(a, modelOf(a)); fillEfforts(a); }
});

window.bridge.onState((s) => {
  lastState = s;
  if (s.ui && !saveUiTimer) {
    uiState = normalizeUi(s.ui);
  }
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
  if ($("subagents")) $("subagents").value = s.cfg.subagents || "research";
  $("brief").value = s.cfg.brief;
  $("verify").value = s.cfg.verify || "";
  $("profile").value = s.cfg.profile || "dengeli";
  for (const a of AGENTS) { fillModels(a, s.cfg.models?.[a] ?? ""); fillEfforts(a, s.cfg.efforts?.[a] ?? ""); }
  const lock = ["project", "pick", "teamsel", "captain", "mode", "kickoff", "subagents", "brief", "verify", "reset", "team", "team-fresh", "profile"];
  for (const a of AGENTS) lock.push("model-" + a, `model-${a}-custom`, "effort-" + a);
  for (const id of lock) if ($(id)) $(id).disabled = isRunning;
  if (!$("skills").hidden) window.bridge.listSkills().then(renderSkills); // proje değişmiş olabilir
  updateLifecycleUI(s);
});

function updateLifecycleUI(s) {
  if (!s) return;
  const members = team();
  const anyResumable = members.some((a) => Boolean(s.resumable?.[a]));
  if ($("team-fresh")) {
    $("team-fresh").hidden = !anyResumable;
    $("team-fresh").disabled = isRunning;
  }
  for (const a of AGENTS) {
    const life = s.life?.[a];
    const lifeWhy = s.lifeWhy?.[a];
    if (!life) continue;
    const resumable = Boolean(s.resumable?.[a]);

    const btnState = getLifecycleButtonState
      ? getLifecycleButtonState(life, resumable)
      : { canStart: true, canStop: true, canSend: true, startLabelKey: resumable ? "resume" : "start", showFresh: resumable };
    const startBtn = document.querySelector(`[data-start="${a}"]`);
    const freshBtn = document.querySelector(`[data-fresh="${a}"]`);
    const stopBtn = document.querySelector(`[data-kill="${a}"]`);
    const sendBtn = $(`send-${a}`);

    if (startBtn) {
      startBtn.disabled = !btnState.canStart;
      startBtn.textContent = t(btnState.startLabelKey || (resumable ? "resume" : "start"));
      startBtn.title = resumable ? t("resumeTitle") : "";
    }
    if (freshBtn) {
      freshBtn.hidden = !btnState.showFresh;
      freshBtn.disabled = !btnState.canStart;
    }
    if (stopBtn) stopBtn.disabled = !btnState.canStop;
    if (sendBtn && !composerControllers[a]?.isSending()) sendBtn.disabled = !btnState.canSend;

    const pf = preflightData?.[a];
    if (pf && pf.ok === false && life === "STOPPED" && !lifeWhy) {
      $(`dot-${a}`).className = "dot FAILED";
      $(`state-${a}`).className = "state failed";
      $(`state-${a}`).textContent = t("cliMissing");
      $(`state-${a}`).title = pf.error || "";
    } else if (life === "STOPPING" || life === "FAILED" || life === "EXITED" || life === "STOPPED") {
      $(`dot-${a}`).className = `dot ${life}`;
      $(`state-${a}`).className = `state ${life.toLowerCase()}`;
      $(`state-${a}`).textContent = formatLifecycleStatus ? formatLifecycleStatus(life, lifeWhy, t) : life;
      $(`state-${a}`).title = "";
    }
  }
}

function setRole(agent, captain) {
  $(`role-${agent}`).textContent = agent === captain ? t("roleCaptain") : t("roleWorker");
}

$("project").addEventListener("change", async () => {
  if (!(await window.bridge.setProject($("project").value))) await showDialog(t("cantSwitch"), { alertOnly: true });
});
$("pick").addEventListener("click", () => window.bridge.pickProject());
$("reset").addEventListener("click", async () => {
  if (await showDialog(t("confirmReset"))) await window.bridge.resetBoard();
});

// ---- terminaller -----------------------------------------------------------
window.bridge.onData(({ agent, data }) => views[agent].term.write(data));
window.bridge.onExit(({ agent, exitCode }) => {
  views[agent].term.write(`\r\n\x1b[90m${t("procClosed", { code: exitCode })}\x1b[0m\r\n`);
});

document.querySelectorAll("[data-start]").forEach((b) =>
  b.addEventListener("click", () => {
    const a = b.dataset.start;
    const { term, fit } = views[a];
    fit.fit();
    resizeFilter.reset(a);
    if (triggerAgentStart) triggerAgentStart(window.bridge, a, term.cols, term.rows, false);
    else window.bridge.start(a, term.cols, term.rows, false);
  }));
document.querySelectorAll("[data-fresh]").forEach((b) =>
  b.addEventListener("click", () => {
    const a = b.dataset.fresh;
    const { term, fit } = views[a];
    fit.fit();
    resizeFilter.reset(a);
    if (triggerAgentStart) triggerAgentStart(window.bridge, a, term.cols, term.rows, true);
    else window.bridge.start(a, term.cols, term.rows, true);
  }));
document.querySelectorAll("[data-kill]").forEach((b) =>
  b.addEventListener("click", () => window.bridge.kill(b.dataset.kill)));

$("team").addEventListener("click", () => {
  fitNow();
  for (const a of team()) resizeFilter.reset(a);
  const sizes = Object.fromEntries(team().map((a) => [a, { cols: views[a].term.cols, rows: views[a].term.rows }]));
  window.bridge.startTeam({ sizes, cfg: currentCfg(), fresh: false });
});
$("team-fresh")?.addEventListener("click", () => {
  fitNow();
  for (const a of team()) resizeFilter.reset(a);
  const sizes = Object.fromEntries(team().map((a) => [a, { cols: views[a].term.cols, rows: views[a].term.rows }]));
  window.bridge.startTeam({ sizes, cfg: currentCfg(), fresh: true });
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
      if (decision === "rework" && !$("decision-note").value.trim() && !(await showDialog(t("confirmNoNote")))) return;
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
const label = (k) => (STR[curLang || "tr"]?.["k_" + k] ? t("k_" + k) : k);
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

// ---- skill'ler ---------------------------------------------------------------
function renderSkills(list) {
  const rows = list.map((s) => {
    const li = el("li");
    const where = el("div", "where");
    where.append(el("span", s.claude ? "" : "off", "Claude · .claude/skills"), el("span", s.agents ? "" : "off", "Codex, Gemini · .agents/skills"));
    const rm = el("button", "", t("skillsRemove"));
    rm.addEventListener("click", async () => {
      if (await showDialog(t("skillsConfirmRemove", { name: s.name }))) renderSkills(await window.bridge.removeSkill(s.name));
    });
    li.append(el("span", "name", s.name), rm, el("span", "desc", s.description), where);
    return li;
  });
  $("skills-list").replaceChildren(...(rows.length ? rows : [el("li", "empty", t("skillsEmpty"))]));
}
async function openSkills() {
  $("reader").hidden = true;
  $("skills-msg").hidden = true;
  renderSkills(await window.bridge.listSkills());
  $("skills").hidden = false;
}
$("skills-open").addEventListener("click", openSkills);
$("skills-close").addEventListener("click", () => { $("skills").hidden = true; fitAll(); });
$("skills-add").addEventListener("click", async () => {
  const r = await window.bridge.addSkills();
  renderSkills(r.list);
  const lines = [];
  if (r.added.length) lines.push(t("skillsAdded", { names: r.added.join(", ") }));
  for (const e of r.errors) lines.push(`${e.name}: ${STR[curLang]["skillsErr_" + e.error] ? t("skillsErr_" + e.error) : e.error}`);
  $("skills-msg").textContent = lines.join("\n");
  $("skills-msg").hidden = !lines.length;
});
$("talk-export").addEventListener("click", () => window.bridge.exportTalk());

let readerMode = "talk";
let openTaskId = null;

async function openTaskDetail(id) {
  readerMode = "task";
  openTaskId = id;
  $("skills").hidden = true;
  if ($("talk-export")) $("talk-export").hidden = true;
  let raw = null;
  try { raw = await window.bridge?.taskDetail?.(id); } catch {}
  if (!raw && lastBoard?.tasks) raw = lastBoard.tasks.find((x) => x.id === id) || null;
  const vm = buildTaskViewModel ? buildTaskViewModel(raw) : null;
  const body = $("reader-body");
  if (!vm) {
    body.replaceChildren(el("p", "empty", t("emptyBoard")));
    $("reader").hidden = false;
    return;
  }
  if ($("reader-title")) $("reader-title").textContent = `#${vm.id} ${vm.title}`;
  const parts = [];
  const head = el("h3");
  head.append(
    el("span", `chip s-${vm.status}`, STR[curLang]["s" + vm.status] ? t("s" + vm.status) : vm.status),
    vm.who ? el("span", "who-" + vm.who, vm.who) : "",
    vm.rounds ? el("span", "", t("round", { n: vm.rounds })) : "",
    vm.dependsOn.length ? el("span", "", "← " + vm.dependsOn.map((d) => "#" + d).join(" ")) : ""
  );
  parts.push(head);
  if (vm.reviewer && vm.status !== "DONE") {
    const sel = el("select");
    sel.append(...team().filter((a) => a !== vm.owner).map((a) => option(a, a)));
    sel.value = vm.reviewer;
    sel.disabled = sel.options.length < 2;
    sel.title = t("taskReviewerHint");
    sel.addEventListener("change", () => window.bridge.setReviewer?.(vm.id, sel.value));
    const row = el("p", "text");
    row.append(sel);
    parts.push(el("h3", "", t("taskReviewer")), row);
  }
  if (vm.description) {
    parts.push(el("h3", "", t("taskSpec")), el("p", "text", vm.description));
  }
  if (vm.touches.length) {
    parts.push(el("h3", "", t("taskTouches")), el("p", "text", vm.touches.join(", ")));
  }
  if (vm.criteria.length) {
    parts.push(el("h3", "", t("taskAcceptance")));
    const ul = el("ul", "criteria-list");
    for (const c of vm.criteria) {
      const li = el("li");
      li.append(
        el("span", `chip chk-${c.status}`, t("chk_" + c.status)),
        el("span", "", `${c.index}. ${c.text}`),
        c.evidence ? el("span", "by", `(${label("evidence")}: ${c.evidence})`) : ""
      );
      ul.append(li);
    }
    parts.push(ul);
  }
  if (vm.summary) {
    parts.push(el("h3", "", t("taskSummary")), el("p", "text", vm.summary));
  }
  if (vm.verify) {
    const vText = vm.verify.ok
      ? t("taskVerifyOk", { cmd: vm.verify.cmd || "", ms: vm.verify.ms ?? 0 })
      : t("taskVerifyFail", { cmd: vm.verify.cmd || "", code: vm.verify.code ?? "?" });
    parts.push(el("p", vm.verify.ok ? "text" : "hint", vText));
  }
  if (vm.unclaimed.length) {
    parts.push(el("p", "hint", t("taskUnclaimed", { files: vm.unclaimed.join(", ") })));
  }
  if (vm.reviews.length) {
    parts.push(el("h3", "", t("taskReviews")));
    for (const r of vm.reviews) {
      const post = el("div", "post " + r.reviewer);
      const by = el("div", "by");
      by.append(
        el("b", "who-" + r.reviewer, r.reviewer),
        document.createTextNode(` · ${t("round", { n: r.round })} · ${r.verdict}`)
      );
      post.append(by, el("p", "text", r.comment));
      if (r.alternative) post.append(el("p", "text", t("taskAlternative", { text: r.alternative })));
      parts.push(post);
    }
  }
  parts.push(el("h3", "", t("taskDiff")));
  if (vm.diffLines.length) {
    const diffBox = el("div", "diff-view");
    for (const l of vm.diffLines) diffBox.append(el("div", `diff-line ${l.kind}`, l.text));
    parts.push(diffBox);
    if (vm.truncated) parts.push(el("p", "by", vm.truncated));
  } else {
    parts.push(el("p", "empty", t("taskNoDiff")));
  }
  body.replaceChildren(...parts);
  $("reader").hidden = false;
}

async function openReader(anchor) {
  readerMode = "talk";
  openTaskId = null;
  if ($("reader-title")) $("reader-title").textContent = t("tabTalk");
  if ($("talk-export")) $("talk-export").hidden = false;
  const { notes, threads, claims = [], decisions = [] } = await window.bridge.talk();
  $("skills").hidden = true;
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
  // Çapraz inceleme: her iddia, altında hükümler ve savunmalar tur sırasıyla
  const entry = (id, who, what, text, evidence) => {
    const post = el("div", "post " + who);
    const by = el("div", "by");
    by.append(el("b", "", id + " "), el("b", "who-" + who, who), document.createTextNode(` · ${what}`));
    post.append(by, el("p", "text", evidence ? `${text}
${label("evidence")}: ${evidence}` : text));
    return post;
  };
  for (const c of claims) {
    const box = el("div", "thread"); box.id = "claim-" + c.id;
    const h = el("h3");
    h.append(el("span", "", `${c.id} `), el("span", "who-" + c.by, c.by), chip(c.status));
    box.append(h, el("p", "text", c.evidence ? `${c.text}
${label("evidence")}: ${c.evidence}` : c.text));
    if (c.original) box.append(el("p", "hint", c.original));
    const rows = [...c.assessments.map((a) => ({ ...a, at: a.round * 2 - 1, what: a.verdict })), ...c.rebuttals.map((r) => ({ ...r, by: c.by, at: r.round * 2, what: r.action }))]
      .sort((a, b) => a.at - b.at);
    for (const r of rows) {
      const to = r.reply_to?.length ? ` → ${[].concat(r.reply_to).join(", ")}` : "";
      box.append(entry(r.id, r.by, `${label("round")} ${r.round} · ${label(r.what)}${to}`, r.text, r.evidence));
    }
    parts.push(box);
  }
  if (decisions.length) {
    const box = el("div", "thread"); box.id = "decisions";
    box.append(el("h3", "", label("decisions")));
    for (const d of decisions) {
      const p = el("p", "text", `${d.id} · ${label(d.kind)}${d.claim ? ` · ${d.claim}` : ""}: ${d.text}${d.refs.length ? ` [${d.refs.join(", ")}]` : ""}`);
      box.append(p);
    }
    parts.push(box);
  }
  body.replaceChildren(...(parts.length ? parts : [el("p", "empty", t("talkEmpty"))]));
  $("reader").hidden = false;
  if (anchor) document.getElementById(anchor)?.scrollIntoView(); else body.scrollTop = keep;
}

function renderTalk(notes, threads, claims = []) {
  const open = threads.filter((x) => x.status === "OPEN").length;
  $("talk-count").textContent = open ? `(${open})` : "";
  const sig = JSON.stringify([notes, threads, claims, curLang]);
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
  if (claims.length) rows.push(el("li", "head", label("cross")));
  rows.push(...claims.map((c) => item("claim-" + c.id, c.by, `${c.id} ${c.text.slice(0, 80)}`, [chip(c.status), el("span", "", t("nPosts", { n: c.posts }))])));
  $("talk-list").replaceChildren(...(rows.length ? rows : [el("li", "empty", t("talkEmpty"))]));
  // Açık okuma görünümü yeni not ya da mesaj gelince kendini yeniler
  if (!$("reader").hidden && readerMode === "talk") openReader();
}

const boardListGuard = createBoardListGuard
  ? createBoardListGuard()
  : { shouldRenderTasks: () => true, shouldRenderEvents: () => true };

function buildEmptyBoardItem() {
  const li = el("li", "empty onboarding");
  li.append(el("div", "", t("emptyBoard")));
  const steps = el("ol", "onboard-steps");
  steps.append(el("li", "", t("step1")), el("li", "", t("step2")), el("li", "", t("step3")));
  li.append(steps);
  if (preflightData) {
    const pfBox = el("div", "preflight-list");
    for (const a of team()) {
      const pf = preflightData[a];
      if (!pf) continue;
      const row = el("div", "preflight-item " + (pf.ok ? "ok" : "bad"));
      row.textContent = pf.ok
        ? `${a}: ${t("cliOk", { info: pf.version || pf.path || "OK" })}`
        : `${a}: ${pf.error || t("cliMissing")}`;
      pfBox.append(row);
    }
    li.append(pfBox);
  }
  return li;
}

function renderBoard({ tasks, events, agents, usage, meta: counters = {}, notes = [], threads = [], claims = [] }) {
  lastUsage = usage || {};
  lastMeta = counters;
  renderUsage();
  renderTalk(notes, threads, claims);
  renderDecision(tasks);
  for (const a of AGENTS) {
    const { status, flow } = agents[a];
    $(`dot-${a}`).className = `dot ${status}`;
    const st = $(`state-${a}`);
    const flowText = flow ? " · " + (STR[curLang || "tr"]?.["f" + flow] ? t("f" + flow) : flow) : "";
    st.textContent = status === "off" ? t("stOff") : `${t(STATUS_KEY[status])}${flowText}`;
    st.className = `state ${status === "approval" ? "approval" : status === "quota" ? "quota" : ""}`;
    if (status === "quota") st.textContent = t("quotaFullWhy", { why: agents[a].why });
  }
  updateLifecycleUI(lastState);

  const done = tasks.filter((x) => x.status === "DONE").length;
  $("summary").textContent = tasks.length ? t("doneOf", { done, total: tasks.length }) : "";
  const preflightSig = preflightData ? JSON.stringify([team(), preflightData]) : "";
  if (boardListGuard.shouldRenderTasks(tasks, curLang, preflightSig)) {
    const list = $("tasks");
    list.replaceChildren(...(tasks.length ? tasks.map((x) => {
      const li = el("li");
      li.append(el("span", "id", `#${x.id}`), el("span", "", x.title));
      const meta = el("div", "meta");
      meta.append(el("span", `chip s-${x.status}`, STR[curLang || "tr"]?.["s" + x.status] ? t("s" + x.status) : x.status));
      const who = x.owner || x.assignee;
      if (who) meta.append(el("span", "", who));
      if (x.rounds) meta.append(el("span", "", t("round", { n: x.rounds })));
      if (x.reviewer && (x.status === "REVIEW" || x.status === "REWORK")) meta.append(el("span", "", t("reviewerIs", { who: x.reviewer })));
      if (x.depends_on.length) meta.append(el("span", "", "← " + x.depends_on.map((d) => "#" + d).join(" ")));
      li.append(meta);
      li.addEventListener("click", () => openTaskDetail(x.id));
      return li;
    }) : [buildEmptyBoardItem()]));
    if (!$("reader").hidden && readerMode === "task" && openTaskId != null) openTaskDetail(openTaskId);
  }

  if (boardListGuard.shouldRenderEvents(events)) {
    const log = $("events");
    const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 20;
    log.replaceChildren(...events.map((e) => {
      const li = el("li");
      li.append(el("span", "who", e.actor + " "), document.createTextNode(e.text));
      return li;
    }));
    if (stick) log.scrollTop = log.scrollHeight;
  }
}

window.bridge.onBoard((b) => { lastBoard = b; renderBoard(b); });
