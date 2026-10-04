// Ajanlara "takımı başlat" ile yazılan protokol (tek satır; TUI'lerde satır sonu = gönder).
// Oturum boyunca bağlamda kaldığı için kısa tutulur; ayrıntılar araç tanımlarında. Dil: i18n.js (pHead, pRules...).
const { t } = require("./i18n");
const other = (a) => (a === "claude" ? "codex" : "claude");

function protocol(agent, { captain, brief, reviewMode, projectDir, resume }) {
  const partner = other(agent);
  const head = t("pHead", { agent, partner, dir: projectDir });
  const rules = t("pRules");
  if (resume) return `${head} ${t("pResume")} ${rules}`;
  const review = reviewMode === "immediate" ? t("pReviewNow") : t("pReviewLater");
  if (agent === captain) return `${head} ${t("pCaptain", { brief })} ${review} ${rules}`;
  return `${head} ${t("pWorker", { captain, brief })} ${review} ${rules}`;
}

module.exports = { protocol, other };
