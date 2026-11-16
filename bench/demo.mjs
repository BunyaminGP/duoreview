// Demo panosu: ekran görüntüleri için örnek veri yazar, istenirse görev ayrıntısı ve Notlar görüntülerini alır.
//   node bench/demo.mjs <klasör> [--lang en|tr] [--shots <çıktı klasörü>]
// <klasör>/shop: boş demo projesi, <klasör>/data: pano, <klasör>/profile: uygulama ayarları (kullanıcının ayarlarına dokunulmaz).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const dir = argv[0] && !argv[0].startsWith("--") ? path.resolve(argv[0]) : null;
const lang = opt("--lang") ?? "en";
if (!dir || !["en", "tr"].includes(lang)) {
  console.error("node bench/demo.mjs <dir> [--lang en|tr] [--shots <outDir>]");
  process.exit(1);
}
const L = (en, tr) => (lang === "tr" ? tr : en);
const project = path.join(dir, "shop"), data = path.join(dir, "data"), profile = path.join(dir, "profile");

const brief = L(
  "Add a cart and a checkout page to the shop, with tests. Research how other shops validate addresses before planning.",
  "Mağazaya sepet ve ödeme sayfası ekleyin, testleriyle birlikte. Planlamadan önce adres doğrulamanın nasıl yapıldığını araştırın.");

const diff = `diff --git a/src/checkout/total.ts b/src/checkout/total.ts
index 3f1c2aa..9b04e71 100644
--- a/src/checkout/total.ts
+++ b/src/checkout/total.ts
@@ -12,9 +12,12 @@ export function orderTotal(cart: Cart, shipping: Shipping) {
   const subtotal = cart.items.reduce((sum, i) => sum + i.price * i.qty, 0);
-  const tax = subtotal * TAX_RATE;
-  return subtotal + tax + shipping.cost;
+  const discount = cart.coupon ? subtotal * cart.coupon.rate : 0;
+  const tax = (subtotal - discount) * TAX_RATE;
+  return round2(subtotal - discount + tax + shipping.cost);
 }
+
+const round2 = (n: number) => Math.round(n * 100) / 100;
diff --git a/src/checkout/CheckoutPage.tsx b/src/checkout/CheckoutPage.tsx
index 71be0c4..c2d95f0 100644
--- a/src/checkout/CheckoutPage.tsx
+++ b/src/checkout/CheckoutPage.tsx
@@ -41,7 +41,7 @@ export function CheckoutPage() {
       <AddressForm value={address} onChange={setAddress} />
-      <button onClick={submit}>Pay</button>
+      <button onClick={submit} disabled={!address.valid || paying}>Pay</button>
     </form>
`;

const tasks = [
  { title: L("Product list API + pagination", "Ürün listesi API'si + sayfalama"), status: "DONE", who: "codex", touches: ["src/api/products.ts"] },
  { title: L("Login form with validation", "Doğrulamalı giriş formu"), status: "DONE", who: "claude", touches: ["src/auth"] },
  { title: L("Cart state and totals", "Sepet durumu ve toplamlar"), status: "REVIEW", who: "gemini", touches: ["src/cart"],
    summary: L("Cart reducer and totals with coupon support; 14 unit tests pass.", "Sepet reducer'ı ve kupon destekli toplamlar; 14 birim testi geçiyor.") },
  { title: L("Checkout page", "Ödeme sayfası"), status: "DISPUTE", who: "codex", rounds: 3, touches: ["src/checkout"],
    description: L(
      "Checkout page with address form, order total and a Pay button. The total must match the cart total including coupon and tax.",
      "Adres formu, sipariş toplamı ve Öde düğmesi olan ödeme sayfası. Toplam, kupon ve vergi dahil sepet toplamıyla aynı olmalı."),
    acceptance: [
      L("npm test -- checkout passes", "npm test -- checkout geçer"),
      L("Order total equals cart total for a cart with a coupon (test)", "Kuponlu sepette sipariş toplamı sepet toplamına eşit (test)"),
      L("Pay is disabled until the address is valid (file:line)", "Adres geçerli olana dek Öde düğmesi kapalı (dosya:satır)"),
    ],
    summary: L("Coupon applied before tax, total rounded to cents, Pay disabled while the address is invalid.",
      "Kupon vergiden önce uygulanıyor, toplam kuruşa yuvarlanıyor, adres geçersizken Öde kapalı."),
    files: ["src/checkout/total.ts", "src/checkout/CheckoutPage.tsx"], diff,
    reviews: [
      [L("Tax is computed before the coupon, so the total differs from the cart by 0.90 for a 10% coupon.",
        "Vergi kupondan önce hesaplanıyor; %10 kuponda toplam sepetten 0,90 farklı çıkıyor."), [true, false, false]],
      [L("Coupon order is fixed. Rounding happens per line in the cart but once at the end here; totals differ by 0.01 on three-item carts.",
        "Kupon sırası düzeldi. Sepette satır başına, burada sonda bir kez yuvarlanıyor; üç kalemli sepette toplam 0,01 farklı."), [true, false, true]],
      [L("Still 0.01 apart: cart rounds each line, checkout rounds the sum. One of the two has to change and that is a product decision.",
        "Hâlâ 0,01 fark var: sepet her satırı, ödeme toplamı yuvarlıyor. İkisinden biri değişmeli; bu bir ürün kararı."), [true, false, true]],
    ] },
  { title: L("Unit tests for cart", "Sepet için birim testleri"), status: "WORKING", who: "claude", touches: ["test/cart"], depends: [3] },
  { title: L("Order confirmation email", "Sipariş onay e-postası"), status: "TODO", who: "gemini", touches: ["src/mail"], depends: [4] },
];

const notes = {
  claude: L("The cart has no single source for money maths: `cart/totals.ts` and `checkout/total.ts` each round on their own. I propose one `money.ts` used by both.",
    "Sepette para hesabının tek kaynağı yok: `cart/totals.ts` ve `checkout/total.ts` ayrı ayrı yuvarlıyor. İkisinin de kullanacağı tek bir `money.ts` öneriyorum."),
  codex: L("Address validation should stay client-side for format and call the postal API only on submit; a request per keystroke would hit the API's rate limit.",
    "Adres doğrulama biçim için istemcide kalmalı, posta API'si yalnız gönderimde çağrılmalı; her tuşta istek API'nin hız sınırına takılır."),
  gemini: L("The product list refetches on every cart change (`useProducts` depends on the whole store). Selecting only `filters` removes the refetch.",
    "Ürün listesi her sepet değişiminde yeniden çekiliyor (`useProducts` tüm store'a bağlı). Yalnız `filters` seçilirse yeniden çekme kalkar."),
};
const claims = [
  { by: "claude", text: L("Cart and checkout round money in different places, so totals can differ by 0.01.", "Sepet ve ödeme parayı farklı yerde yuvarlıyor; toplamlar 0,01 farklı çıkabilir."),
    evidence: "src/cart/totals.ts:18, src/checkout/total.ts:14",
    as: [["codex", 1, "agree", L("Reproduced with three items at 3.33.", "3,33'lük üç kalemle yeniden üretildi.")], ["gemini", 1, "agree", L("Same result in the cart tests.", "Sepet testlerinde aynı sonuç.")]] },
  { by: "codex", text: L("The postal API should be called on submit only, not while typing.", "Posta API'si yazarken değil, yalnız gönderimde çağrılmalı."),
    original: L("The postal API must never be called from the browser.", "Posta API'si tarayıcıdan hiç çağrılmamalı."),
    evidence: L("API docs: 60 requests/min per key", "API belgesi: anahtar başına dakikada 60 istek"),
    as: [["claude", 1, "disagree", L("The key is a public browser key by design; the limit is the real problem.", "Anahtar tasarım gereği herkese açık tarayıcı anahtarı; asıl sorun hız sınırı.")],
      ["gemini", 1, "unsure", L("No measurement of how often users retype the address.", "Kullanıcıların adresi ne sıklıkta yeniden yazdığına dair ölçüm yok.")],
      ["claude", 2, "agree", L("Agreed after the revision.", "Düzeltmeden sonra katılıyorum.")], ["gemini", 2, "agree", L("Submit-only is enough.", "Yalnız gönderimde çağırmak yeterli.")]],
    rb: ["revise", L("Narrowed to the rate limit: call on submit only.", "Hız sınırına daraltıldı: yalnız gönderimde çağır.")] },
  { by: "gemini", text: L("`useProducts` refetches on every cart change.", "`useProducts` her sepet değişiminde yeniden çekiyor."),
    evidence: "src/products/useProducts.ts:9",
    as: [["claude", 1, "agree", L("Network tab shows one request per cart click.", "Ağ sekmesi her sepet tıklamasında bir istek gösteriyor.")],
      ["codex", 1, "alternative", L("Memoise the selector instead of narrowing the dependency; same effect, smaller diff.", "Bağımlılığı daraltmak yerine seçiciyi memoize et; aynı etki, daha küçük diff.")]] },
];
const events = [
  ["app", L("team started (claude, codex, gemini). captain: claude, review: when all done, kickoff: cross review", "takım başlatıldı (claude, codex, gemini). kaptan: claude, inceleme: hepsi bitince, açılış: çapraz inceleme")],
  ["claude", L("consensus: 3 claims decided (2 accepted, 1 unresolved)", "uzlaşma: 3 iddia karara bağlandı (2 kabul, 1 çözülemedi)")],
  ["claude", L("6 tasks planned", "6 görev planlandı")],
  ["gemini", L("#1 approved", "#1 onaylandı")],
  ["codex", L("#2 approved", "#2 onaylandı")],
  ["gemini", L("#3 \"Cart state and totals\" submitted for review", "#3 \"Sepet durumu ve toplamlar\" incelemeye gönderildi")],
  ["claude", L("#5 \"Unit tests for cart\" started", "#5 \"Sepet için birim testleri\" başladı")],
  ["gemini", L("requested changes on #4 (round 3/3) → DISPUTE", "#4 için değişiklik istedi (tur 3/3) → İHTİLAF")],
];

for (const d of [project, profile]) fs.mkdirSync(d, { recursive: true });
fs.rmSync(data, { recursive: true, force: true });
fs.writeFileSync(path.join(profile, "settings.json"), JSON.stringify({
  lang, projectDir: project, recents: [project],
  byProject: { [project]: { team: ["claude", "codex", "gemini"], captain: "claude", kickoff: "cross", brief } },
}, null, 2));

const { openDb } = await import(pathToFileURL(path.join(root, "dist", "db.js")).href);
const db = openDb(data);
const run = (sql, ...p) => db.prepare(sql).run(...p).lastInsertRowid;
const reviewer = { claude: "codex", codex: "gemini", gemini: "claude" };
for (const [k, v] of Object.entries({ team: "claude,codex,gemini", captain: "claude", review_mode: "after_all", kickoff: "cross", subagents: "research" })) {
  run("INSERT INTO meta (key, value) VALUES (?, ?)", k, v);
}
for (const t of tasks) {
  const id = run(
    "INSERT INTO tasks (title, description, status, assignee, owner, touches, depends_on, acceptance, summary, files, rounds, diff) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    t.title, t.description ?? "", t.status, t.who, t.status === "TODO" ? null : t.who, JSON.stringify(t.touches), JSON.stringify(t.depends ?? []),
    JSON.stringify(t.acceptance ?? []), t.summary ?? null, JSON.stringify(t.files ?? []), t.rounds ?? 0, t.diff ?? null);
  for (const [comment, oks] of t.reviews ?? []) {
    run("INSERT INTO reviews (task_id, reviewer, verdict, comment, checks) VALUES (?,?,?,?,?)", id, reviewer[t.who], "request_changes", comment,
      JSON.stringify(oks.map((ok, i) => ({ ok, evidence: ok ? ["npm test -- checkout: 9 passed", "", "src/checkout/CheckoutPage.tsx:44"][i] : "test/checkout/total.test.ts: expected 26.97, got 26.98" }))));
  }
}
for (const c of claims) {
  const note = run("INSERT INTO notes (author, kind, title, text) VALUES (?, 'kickoff', ?, ?)", c.by, L("Analysis", "Analiz"), notes[c.by]);
  const id = run("INSERT INTO claims (note_id, author, text, original, evidence) VALUES (?,?,?,?,?)", note, c.by, c.text, c.original ?? c.text, c.evidence);
  const objections = [];
  for (const [who, round, verdict, text] of c.as.filter((a) => a[1] === 1)) {
    const a = run("INSERT INTO assessments (claim_id, reviewer, round, verdict, text) VALUES (?,?,?,?,?)", id, who, round, verdict, text);
    if (verdict !== "agree") objections.push(Number(a));
  }
  const rb = c.rb ? run("INSERT INTO rebuttals (claim_id, author, round, action, text, reply_to) VALUES (?,?,1,?,?,?)", id, c.by, c.rb[0], c.rb[1], JSON.stringify(objections)) : null;
  for (const [who, round, verdict, text] of c.as.filter((a) => a[1] === 2)) {
    run("INSERT INTO assessments (claim_id, reviewer, round, verdict, text, reply_to) VALUES (?,?,?,?,?,?)", id, who, round, verdict, text, rb);
  }
}
for (const [kind, claim, text, refs] of [
  ["accepted", 1, L("One money module for cart and checkout.", "Sepet ve ödeme için tek para modülü."), ["C1", "A1", "A2"]],
  ["accepted", 2, L("Postal API on submit only.", "Posta API'si yalnız gönderimde."), ["C2", "R1", "A5", "A6"]],
  ["unresolved", 3, L("Refetch is real; narrowing the dependency or memoising the selector is left to the task owner.", "Yeniden çekme gerçek; bağımlılığı daraltmak mı seçiciyi memoize etmek mi, görev sahibine bırakıldı."), ["C3", "A8"]],
  ["missing_evidence", null, L("How often users retype an address was not measured.", "Kullanıcıların adresi ne sıklıkta yeniden yazdığı ölçülmedi."), ["A4"]],
]) run("INSERT INTO decisions (kind, claim_id, text, refs, author) VALUES (?,?,?,?,'claude')", kind, claim, text, JSON.stringify(refs));

const thread = (kind, topic, outcome, posts) => {
  const id = run("INSERT INTO threads (kind, topic, status, outcome, opened_by, max_posts) VALUES (?,?,'CLOSED',?,?,6)", kind, topic, outcome, posts[0][0]);
  for (const [author, stance, text] of posts) run("INSERT INTO posts (thread_id, author, stance, text) VALUES (?,?,?,?)", id, author, stance, text);
};
thread("plan", L("Plan and split", "Plan ve iş bölümü"), "agreed", [
  ["claude", "propose", L("Six tasks, two each. Checkout waits for the cart totals.", "Altı görev, kişi başı iki. Ödeme, sepet toplamlarını bekler.")],
  ["codex", "agree", L("Fine. I take the API and checkout.", "Uygun. API ve ödemeyi alıyorum.")],
  ["gemini", "agree", L("Agreed.", "Katılıyorum.")],
]);
thread("free", L("Where to round money", "Para nerede yuvarlanmalı"), "split", [
  ["codex", "propose", L("Round once, on the order total.", "Bir kez, sipariş toplamında yuvarlayalım.")],
  ["gemini", "object", L("Invoices list rounded lines; the sum of lines must equal the total.", "Faturada satırlar yuvarlanmış görünür; satırların toplamı genel toplama eşit olmalı.")],
  ["claude", "object", L("Both are defensible; the accounting rule decides, not us.", "İkisi de savunulabilir; kararı biz değil muhasebe kuralı verir.")],
]);
for (const [actor, text] of events) run("INSERT INTO events (actor, text) VALUES (?, ?)", actor, text);
db.close();

const appArgs = [`--user-data-dir=${profile}`, "--project", project, "--data", data, "--lang", lang];
console.log(`DUOREVIEW_FAKE=1 npx electron . ${appArgs.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")} --screenshot docs/screenshot-${lang}.png`);

// Görev ayrıntısı ve Notlar görünümü tıklama ister; uygulama hata ayıklama kapısıyla açılıp oradan sürülür.
const shots = opt("--shots");
if (shots) {
  const port = 9351, out = path.resolve(shots);
  const { default: electron } = await import("electron");
  const child = spawn(electron, [root, ...appArgs, `--remote-debugging-port=${port}`], { env: { ...process.env, DUOREVIEW_FAKE: "1" }, stdio: "ignore" });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    let page;
    for (let i = 0; i < 40 && !page; i++) {
      await sleep(500);
      try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((p) => p.type === "page"); } catch {}
    }
    if (!page) throw new Error("uygulama açılmadı");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let seq = 0;
    const cdp = (method, params = {}) => new Promise((res) => {
      const id = ++seq;
      const on = (m) => { const d = JSON.parse(m.data); if (d.id === id) { ws.removeEventListener("message", on); res(d.result); } };
      ws.addEventListener("message", on);
      ws.send(JSON.stringify({ id, method, params }));
    });
    const shot = async (name, js) => {
      await cdp("Runtime.evaluate", { expression: js });
      await sleep(800);
      fs.writeFileSync(path.join(out, name), Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
      console.log(path.join(out, name));
    };
    await sleep(3000);
    await shot(`task-${lang}.png`, `document.querySelector("#tasks li:nth-child(4)").click()`);
    await shot(`notes-${lang}.png`, `document.getElementById("tab-talk").click(); document.querySelector("#talk-list li:not(.head)").click()`);
    ws.close();
  } finally { child.kill(); }
}
