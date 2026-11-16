// Notları, tartışmaları ve çapraz inceleme kaydını tek bir Markdown belgesine çevirir (dışa aktarma). Electron'a bağımlı değildir.
function talkMarkdown({ notes, threads, claims = [], decisions = [], deliveries = [] }, { title, labels }) {
  const L = (k) => labels[k] ?? k;
  const out = [`# ${title}`, ""];
  for (const n of notes) {
    out.push(`## ${n.author}: ${n.title || labels[n.kind] || n.kind}`, `_${n.created_at}_`, "", n.text.trim(), "");
  }
  for (const th of threads) {
    out.push(`## #${th.id} ${th.topic}`, `_${labels[th.outcome ?? th.status] ?? th.outcome ?? th.status}_`, "");
    for (const p of th.posts) out.push(`**${p.author}** (${labels[p.stance] ?? p.stance}, ${p.created_at})`, "", p.text.trim(), "");
  }
  if (claims.length) out.push(`## ${L("cross")}`, "");
  const ev = (e) => (e ? ` (${L("evidence")}: ${e})` : "");
  for (const c of claims) {
    out.push(`### ${c.id} ${c.by} · ${L(c.status)}`, "", c.text.trim() + ev(c.evidence), "");
    if (c.original) out.push(`~~${c.original.trim()}~~`, "");
    // Hükümler ve savunmalar tur sırasıyla: 1. tur hükümleri, 1. tur savunması, 2. tur hükümleri...
    const rows = [...c.assessments.map((a) => ({ ...a, at: a.round * 2 - 1 })), ...c.rebuttals.map((r) => ({ ...r, by: c.by, verdict: r.action, at: r.round * 2 }))]
      .sort((a, b) => a.at - b.at);
    for (const r of rows) {
      const to = r.reply_to?.length ? ` → ${[].concat(r.reply_to).join(", ")}` : "";
      out.push(`- **${r.id}** ${r.by} · ${L("round")} ${r.round} · ${L(r.verdict)}${to}: ${r.text.trim()}${ev(r.evidence)}`);
    }
    out.push("");
  }
  if (decisions.length) {
    out.push(`## ${L("decisions")}`, "");
    for (const d of decisions) {
      out.push(`- **${d.id}** ${L(d.kind)}${d.claim ? ` ${d.claim}` : ""}: ${d.text.trim()}${d.refs.length ? ` [${d.refs.join(", ")}]` : ""}`);
    }
    out.push("");
  }
  if (deliveries.length) {
    out.push(`## ${L("deliveries")}`, "");
    const by = {};
    for (const d of deliveries) (by[d.recipient] ??= []).push(d.item);
    for (const [who, items] of Object.entries(by)) out.push(`- ${who}: ${items.join(" ")}`);
    out.push("");
  }
  return out.join("\n");
}

module.exports = { talkMarkdown };
