// Görev ayrıntısı görünüm modeli, diff satır sınıflandırması ve pano liste imza bekçisi.
// Hem Electron renderer (<script>) hem de Node.js birim testleri (test/taskview.test.mjs) tarafından kullanılır.
(function (root) {
  function classifyDiffLine(line) {
    const s = String(line ?? "");
    if (s.startsWith("+++") || s.startsWith("---") || s.startsWith("diff ") || s.startsWith("index ")) return "meta";
    if (s.startsWith("@@")) return "hunk";
    if (s.startsWith("+")) return "add";
    if (s.startsWith("-")) return "del";
    return "ctx";
  }

  function parseDiffLines(diffText) {
    if (typeof diffText !== "string" || !diffText.trim()) return [];
    return diffText.split(/\r?\n/).map((line) => ({
      text: line,
      kind: classifyDiffLine(line),
    }));
  }

  function buildTaskViewModel(detail) {
    if (!detail || typeof detail !== "object") return null;
    const reviews = Array.isArray(detail.reviews)
      ? detail.reviews.map((r, i) => ({
          round: i + 1,
          reviewer: String(r?.reviewer || ""),
          verdict: String(r?.verdict || ""),
          comment: String(r?.comment || ""),
          checks: Array.isArray(r?.checks)
            ? r.checks.map((c) => ({
                ok: Boolean(c?.ok),
                blocked: Boolean(c?.blocked),
                evidence: String(c?.evidence || ""),
              }))
            : [],
          alternative: r?.alternative ? String(r.alternative) : "",
        }))
      : [];

    const lastChecks = reviews.length ? reviews[reviews.length - 1].checks : [];
    const rawAcceptance = Array.isArray(detail.acceptance) ? detail.acceptance : [];
    const criteria = rawAcceptance.map((text, i) => {
      const chk = lastChecks[i];
      const status = chk ? (chk.ok ? "ok" : chk.blocked ? "blocked" : "fail") : "pending";
      return {
        index: i + 1,
        text: String(text ?? ""),
        status,
        evidence: chk?.evidence || "",
      };
    });

    return {
      id: detail.id,
      title: String(detail.title || ""),
      status: String(detail.status || "TODO"),
      who: String(detail.owner || detail.assignee || ""),
      owner: String(detail.owner || ""),
      reviewer: String(detail.reviewer || ""),
      rounds: Number(detail.rounds) || 0,
      description: String(detail.description || ""),
      touches: Array.isArray(detail.touches) ? detail.touches.map(String) : [],
      dependsOn: Array.isArray(detail.depends_on) ? detail.depends_on : [],
      summary: detail.summary ? String(detail.summary) : "",
      files: Array.isArray(detail.files) ? detail.files.map(String) : [],
      unclaimed: Array.isArray(detail.unclaimed) ? detail.unclaimed.map(String) : [],
      verify: detail.verify && typeof detail.verify === "object" ? detail.verify : null,
      truncated: detail.truncated ? String(detail.truncated) : "",
      criteria,
      reviews,
      diffLines: parseDiffLines(detail.diff),
    };
  }

  function createBoardListGuard() {
    let tasksSig = "";
    let eventsSig = "";
    return {
      shouldRenderTasks(tasks, lang = "", preflightSig = "") {
        const next = JSON.stringify([tasks ?? [], lang, preflightSig]);
        if (next === tasksSig) return false;
        tasksSig = next;
        return true;
      },
      shouldRenderEvents(events) {
        const next = JSON.stringify(events ?? []);
        if (next === eventsSig) return false;
        eventsSig = next;
        return true;
      },
      reset() {
        tasksSig = "";
        eventsSig = "";
      },
    };
  }

  const api = {
    classifyDiffLine,
    parseDiffLines,
    buildTaskViewModel,
    createBoardListGuard,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.TaskViewLib = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
