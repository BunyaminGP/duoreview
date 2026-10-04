// Ajan başlatılamayınca ana süreci çökertmek yerine terminale anlaşılır bir açıklama yazılır.
const { t } = require("./i18n");

const HINTS = [
  [/error code: 32\b/, "errBusy"],
  [/error code: 216\b/, "errBadExe"],
  [/error code: 267\b/, "errBadDir"],
  [/error code: 2\b/, "errNotFound"],
];

function describeSpawnError(agent, err) {
  const msg = String((err && err.message) || err);
  const key = (HINTS.find(([re]) => re.test(msg)) || [])[1];
  const body = [msg, key && t(key)].filter(Boolean).join("\n").replace(/\n/g, "\r\n");
  return {
    summary: t("evSpawnFail", { agent, msg: msg.split("\n")[0] }),
    terminalText: `\r\n\x1b[31m${t("termSpawnFail", { agent })}\x1b[0m\r\n${body}\r\n`,
  };
}

module.exports = { describeSpawnError };
