# DuoReview

**Claude Code, Codex ve Gemini işi bölüşsün, birbirinin işini incelesin, anlaşamazlarsa son kararı sana bıraksın.**

[English](README.md) · MIT · Node ≥ 22.13 · Windows ✔ · macOS/Linux: denenmedi, bkz. [Sınırlar](#sınırlar)

![DuoReview](docs/screenshot-tr.png)
*Ekran görüntüsü örnek verilerle hazırlanmıştır.*

DuoReview bir [MCP](https://modelcontextprotocol.io) sunucusu ve küçük bir Electron uygulamasıdır.
`claude`, `codex` ve `agy` (Antigravity CLI, Gemini için) CLI'larını en çok üç terminalde yan yana çalıştırır ve hepsine ortak bir görev panosu verir.

## Neden

Kodu yazan model kendi kodunu incelediğinde kendi ödevini notlandırmış olur. Farklı şirketlerin modellerinin
kör noktaları farklıdır. Bu yüzden burada **her görevi başka bir şirketin ajanı inceler**: üç kişilik takımda Claude'unkini Codex,
Codex'inkini Gemini, Gemini'ninkini Claude; iki kişilik takımda ikisi birbirininkini.

- **Takımı seç.** Claude + Codex + Gemini ya da herhangi ikisi (üst çubuktaki menü). `agy` kurulu değilse takım Claude + Codex olarak gelir.
- **Önce hepsi düşünür.** Varsayılan açılışta her ajan talimatını kendi başına çalışır (kodu okur, istediysen internette araştırır) ve bir not yazar. Notlar hepsi yazana kadar birbirinden gizlidir; böylece sonraki öncekinin tekrarı olmaz. Sonra farkları tartışırlar; söz sırayla döner, son öneriyi yazan dışında herkes katılınca tartışma uzlaşmayla kapanır.
- **Kaptan + işçiler.** Bir ajan (hangisi olacağını sen seçersin) notları küçük görevlere çevirir ve dengeli böler. Öbür ajanlar plana katılmadan ya da itiraz etmeden kimse işe başlamaz.
- **Okuyabildiğin tartışmalar.** Notlar ve bütün tartışmalar *Notlar ve tartışma* sekmesinde yan yana durur, tek bir Markdown dosyasına aktarılır. Mesaj sınırına uzlaşmadan ulaşan tartışma *ayrışma* diye işaretlenir; nerede anlaşamadıklarını görürsün.
- **Çapraz inceleme.** Kimse kendi görevini incelemez. Yalnız `blocker` / `major` bulgular görevi durdurur, küçük notlar durdurmaz.
- **Beraberlikte karar sende.** 3 inceleme turunda uzlaşılamazsa görev *ihtilaf* olur: kabul et, yeniden incelet ya da talimatınla geri gönder.
- **Dosya çakışma koruması.** Her görev dokunacağı dosyaları bildirir. Ortağın bitmemiş görevine çakışan bir göreve başlanamaz.
- **Kota farkındalığı.** 5 saatlik ve haftalık kullanım göstergesi vardır. Kota dolunca uygulama o ajanı dürtmeyi bırakır, boşuna token yakmaz.
- **Görev bağımlılığı.** Bir görev, önce bitmesi gereken görevleri (`depends_on`) belirtebilir; onlar onaylanmadan başlatılamaz.
- **Token tasarrufu.** `submit_task`, `review_task`, `post_note`, `discuss` ve `post_tasks` cevabı sıradaki adımı taşır, `next_action` sıradaki görevi kendisi üstlenir; ölçülen basit görev senaryosu (üstlen, gönder, inceleyen uyanır, incele) dört araç çağrısıdır (`npm run tokens`); açılış, tartışma ve yeniden çalışma turları buna dahil değildir. Başlıkta her ajanın araç çağrısı sayısı ile giden/gelen karakteri görünür (MCP sunucusu sayar; token değildir). Görev tarifi oturumda bir kez gider (`status(id)` yeniden verir), cevaplar küçüktür. Ekonomik / dengeli / güçlü profiller tek tıkla seçilir. Model menüleri CLI'ların sunduğu bütün modelleri listeler (Codex'inkiler kendi önbelleğinden), her modelin desteklediği efor seviyeleriyle.
- **Ajanlar için üslup kuralları.** İki ajana giden kurallar kodda ve metinde alışılmış dolguyu yasaklar: kodu tekrar eden yorum, istenmemiş soyutlama ve dosya, giriş cümlesi, kapanış özeti, övgü, emoji. İnceleyen, istenmemiş dosyayı ve ilgisiz değişikliği `major` sayar.
- **CLI izin verdiği sürece global ayarlarına dokunmaz.** MCP bağlantısı oturum başına verilir (Claude'a `--mcp-config`, Codex'e `-c`). `agy` MCP sunucusunu ve araç iznini yalnız global ayarından okur; bu yüzden Gemini başlarken uygulama `duoreview` sunucusunu (`agy mcp add`) ve `mcp(duoreview/*)` iznini ekler, Gemini kapanınca ikisini de siler. Pano verisi projenin dışında tutulur, reponun kirlenmez.
- **Türkçe ve İngilizce** arayüz, prompt ve araç metinleri (üst çubuktaki dil menüsü).

## Hızlı başlangıç

Gerekenler: Node.js ≥ 22.13, kurulu ve giriş yapılmış `claude` ve `codex` CLI'ları. Gemini için kurulu ve giriş yapılmış Antigravity CLI (`agy`);
Google, Gemini CLI'yi kişisel hesaplara kapattığı için DuoReview `agy`yi kullanır. Windows'ta: `irm https://antigravity.google/cli/install.ps1 | iex`, sonra giriş için bir kez `agy` çalıştır.

```powershell
npm install
npm run app -- --project "C:\projenin\yolu"
```

Takımı ve kaptanı seç, talimatı yaz ("giriş sayfası ve testlerini ekle" ya da "projeyi analiz edin, eksikleri çıkarın") ve **Takımı başlat**'a bas.
Uygulama ajanları proje klasöründe başlatır, MCP sunucusunu bağlar ve her terminale tek kısa satır yazar; kurallar ve talimatın ajanlara MCP sunucusundan gider.

Açılışın iki ayarı var. *Hepsi incelesin, tartışsın* varsayılandır ve daha çok token harcar: ajan başına bir inceleme, açılış ve plan için en çok dörder mesaj (üç ajanda altışar). *Yalnız kaptan planlasın* bunu atlar, doğrudan görev panosuna geçer.

Hakem bir ajanın terminaline yalnız ajan boştayken ve ekranda onay sorusu ya da menü yokken yazar (Codex'in açılıştaki güncelleme ve klasöre güven menüleri ile `agy`nin klasöre güven sorusu dahil). Enter'a basmadan önce yankının durulmasını bekler, ajan çalışmaya başlamadıysa yeniden basar; çünkü Codex hızlı gelen karakterlerin arasındaki Enter'ı satır sonu sayar.

| Komut | Ne yapar |
|---|---|
| `npm run build` | MCP sunucusunu derler (`tsc`) |
| `npm start` | MCP sunucusunu tek başına çalıştırır (`AGENT_ID` ve `DUOREVIEW_DIR` gerekir) |
| `npm test` | Derler ve tüm testleri çalıştırır (model kotası harcamaz) |

Uygulama olmadan MCP kullanımı ve ayar örneği için [İngilizce README](README.md#using-the-mcp-server-without-the-app) bölümüne bak.
Ajanların izlediği döngü [TEAM.md](TEAM.md) dosyasındadır.

## Sınırlar

- **Windows**'ta geliştirildi ve denendi. macOS/Linux'ta `claude`/`codex` `PATH` üzerinden aranır, ama gerçek bir Mac veya Linux makinede henüz çalıştırılmadı (CI, Electron gerektirmeyen testleri Ubuntu'da koşar). Geri bildirim memnuniyetle.
- CLI alışılmadık bir yere kurulduysa yolu ver: `DUOREVIEW_CLAUDE_BIN=/yol/claude`, `DUOREVIEW_CODEX_BIN=/yol/codex`, `DUOREVIEW_GEMINI_BIN=/yol/agy`.
- Ajanlar aynı çalışma klasörünü paylaşır (çakışma git worktree ile değil, `touches` denetimiyle önlenir).
- İki ya da üç ajan: Claude Code, Codex CLI ve Antigravity CLI üzerinden Gemini.
- Gemini'nin MCP kaydı global olduğu için Gemini'yi aynı anda tek bir DuoReview penceresinde çalıştır. Gemini için kullanım göstergesi henüz yok.
- Şimdilik yalnız kaynak koddan dağıtım: klonla, `npm install` ve `npm run app`. npm paketi veya kurulum dosyası henüz yok.
- `node:sqlite` Node'da hâlâ deneysel, bu yüzden bir uyarı görürsün.

## Güvenlik

Ajanlar **senin** kullanıcı haklarınla **senin** proje klasöründe çalışır. Codex'te DuoReview MCP araçları otomatik onaylıdır
(`default_tools_approval_mode="approve"`), Claude'da yalnız `mcp__duoreview` araçları önceden izinlidir, Gemini çalışırken `permissions.allow` içinde `mcp(duoreview/*)` durur. Diğer her şey CLI'ların
normal onay sorularından geçer. Hakem, bir onay sorusuna senin yerine Enter'a basmaz.
Kimlik bilgileri CLI'ların kendi kayıtlarında (`~/.claude`, `~/.codex`, `~/.gemini`) kalır; DuoReview bunları okumaz, saklamaz, göndermez (göstergeler için yalnız yerel Codex oturum günlüklerinden kullanım yüzdelerini okur). DuoReview'in kendisi ağa çıkmaz; Gemini'nin model menüsü için `agy models` çalıştırır, o da Google'ın sunucularına sorar.
Bir kodlama ajanının düzenlemesine razı olacağın projelerde kullan, commit ve push'u elle yap.

## Yol haritası

- Ajan başına git worktree, diff görünümü ve birleştirme adımı
- "Doğrulama komutu" kapısı (build ve testler geçmeden görev incelemeye girmesin)
- macOS/Linux desteği

## Lisans

[MIT](LICENSE)
