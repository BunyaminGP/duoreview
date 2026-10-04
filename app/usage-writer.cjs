// Claude Code durum çubuğu (statusLine) komutu: stdin'deki oturum JSON'unu dosyaya yazar.
// Kullanım: node usage-writer.cjs <çıktı.json>   (yalnız DuoReview'in başlattığı Claude oturumunda çalışır)
const fs = require("node:fs");

const out = process.argv[2];
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  try {
    const j = JSON.parse(input);
    const snapshot = {
      at: Date.now(),
      rate_limits: j.rate_limits ?? null,
      model: j.model?.display_name ?? j.model?.id ?? null,
      ctx: j.context_window?.used_percentage ?? null,
      cost: j.cost?.total_cost_usd ?? null,
    };
    fs.writeFileSync(out + ".tmp", JSON.stringify(snapshot));
    fs.renameSync(out + ".tmp", out);
  } catch {
    // sessizce geç: durum çubuğu asla oturumu bozmamalı
  }
  process.stdout.write("");
});
