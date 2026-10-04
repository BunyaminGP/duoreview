// Dil dosyaları: iki dilde de aynı anahtarlar var mı, yer tutucular eşleşiyor mu, dil değişince metin değişiyor mu?
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const app = createRequire(import.meta.url)("../app/i18n.js");
const srv = await import("../dist/i18n.js");

const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
function parity(name, cats) {
  const [base, ...rest] = Object.entries(cats);
  for (const [lang, cat] of rest) {
    assert.deepEqual(Object.keys(cat).sort(), Object.keys(base[1]).sort(), `${name}: ${lang} anahtarları ${base[0]} ile aynı olmalı`);
    for (const k of Object.keys(cat)) assert.equal(holes(cat[k]), holes(base[1][k]), `${name}.${k}: {yer tutucu} kümesi aynı olmalı`);
  }
}
parity("app", app.STR);
parity("server", srv.MESSAGES);

app.setLang("en"); assert.equal(app.t("start"), "Start");
app.setLang("tr"); assert.equal(app.t("start"), "Başlat");
assert.equal(app.norm("tr-TR"), "tr"); assert.equal(app.norm("en-US"), "en"); assert.equal(app.norm("de"), "en");
assert.equal(app.t("doneOf", { done: 2, total: 5 }), "2/5 bitti");

srv.setLang("en"); assert.match(srv.t("fileClash", { id: 4, owner: "claude" }), /touches the same files/);
srv.setLang("tr"); assert.match(srv.t("fileClash", { id: 4, owner: "claude" }), /aynı dosyalara/);
console.log("I18N OK");
