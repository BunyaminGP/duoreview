// Notları ve tartışmaları tek bir Markdown belgesine çevirir (dışa aktarma). Electron'a bağımlı değildir.
function talkMarkdown({ notes, threads }, { title, labels }) {
  const out = [`# ${title}`, ""];
  for (const n of notes) {
    out.push(`## ${n.author}: ${n.title || labels[n.kind] || n.kind}`, `_${n.created_at}_`, "", n.text.trim(), "");
  }
  for (const th of threads) {
    out.push(`## #${th.id} ${th.topic}`, `_${labels[th.outcome ?? th.status] ?? th.outcome ?? th.status}_`, "");
    for (const p of th.posts) out.push(`**${p.author}** (${labels[p.stance] ?? p.stance}, ${p.created_at})`, "", p.text.trim(), "");
  }
  return out.join("\n");
}

module.exports = { talkMarkdown };
