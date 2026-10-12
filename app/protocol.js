// "Takımı başlat" ile ajanın terminaline yazılan tek satır. Kurallar, rol ve talimat buradan gitmez:
// MCP sunucusu ilk next_action cevabına ekler (src/flow.ts briefing). Terminale uzun metin yapıştırmak güvenilir değil.
const { t } = require("./i18n");
const other = (a) => (a === "claude" ? "codex" : "claude");

const protocol = (agent) => t("pStart", { agent, partner: other(agent) });

module.exports = { protocol, other };
