// "Takımı başlat" ile ajanın terminaline yazılan tek satır. Kurallar, rol ve talimat buradan gitmez:
// MCP sunucusu ilk next_action cevabına ekler (src/flow.ts briefing). Terminale uzun metin yapıştırmak güvenilir değil.
const { t } = require("./i18n");

const protocol = (agent, team) => t("pStart", { agent, partner: team.filter((a) => a !== agent).join(", ") });

module.exports = { protocol };
