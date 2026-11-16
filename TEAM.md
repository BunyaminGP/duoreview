# Takım Protokolü (Claude + Codex + Gemini)

Bu projede `duoreview` MCP sunucusu üzerinden bir ya da iki ortağınla çalışıyorsun (takım ilk cevaptaki kurallarda yazar). Bu dosya geçerli olduğunda aşağıdaki akışı izle.

## Döngü
1. Göreve `next_action` ile başla. İlk cevapta rolün, kullanıcının talimatı ve kurallar gelir. Araç cevabında `next` alanı varsa sıradaki adım odur; yoksa `next_action` çağır. `action` ne diyorsa onu yap:
   - `ANALYZE` → talimatı kendi başına yerine getir (kodu oku, talimat istiyorsa internette araştır) ve bulgularını `post_note` ile yaz. Ortaklarını bekleme; notlar hepiniz yazana kadar birbirinizden gizlidir.
   - `CROSS_REVIEW` (çapraz inceleme açılışı) → ortaklarının tam notlarını ve iddialarını (`C` kimlikli) oku, `assess(items)` ile her iddiaya ayrı hüküm ver: `agree` (gerekçe + kanıt), `disagree` (yanlış varsayım + kanıt), `unsure` (eksik kanıt), `alternative` (farklı yaklaşım ve kazancı). 2. turda iddia sahibinin savunmasını okuyup hükmünü korur ya da değiştirirsin.
   - `REBUTTAL` → iddialarına gelen itirazları (`A` kimlikli) oku, `rebut(items)` ile her biri için `defend` (yeni kanıtla), `revise` (`revised`: düzeltilmiş iddia) ya da `withdraw`. İtirazsız iddiaya ek tur açılmaz; en çok 2 hüküm turu vardır, kalan ayrılık kaptanın kararına "çözülemedi" olarak gider.
   - `CONSENSUS` (kaptan) → `post_consensus(decisions)`: her iddiaya tam bir kez `accepted` / `rejected` / `unresolved`, ek olarak `missing_evidence` ve `verification` maddeleri; `refs` ile dayanılan `C`/`A`/`R` kimlikleri. Sonra `PLAN` gelir.
   - `DISCUSS` → gelen notu ve mesajları oku, `discuss(thread, stance, text)` ile yanıtla. Son öneriyi yazan dışında herkes `agree` deyince tartışma kapanır; söz takım sırasında döner; `object` gerekçe ister; `propose` yeni öneridir. Mesaj sınırı dolunca uzlaşma yoksa tartışma "ayrışma" olarak kapanır ve kullanıcıya gösterilir.
   - `PLAN` (kaptan) → notları ve tartışmayı birleştir, `post_tasks` ile işleri takımdaki ajanlara dengeli böl. Her göreve `touches` (dokunulacak dosyalar) ve `acceptance` (inceleyicinin tek tek doğrulayacağı ölçülebilir kriterler) yaz. Başka görevin bitmesini bekleyen işe `depends_on` ver: aynı plandaki göreve `key` ile, mevcut göreve id ile. İş çıkmıyorsa `post_tasks(tasks: [])`. Plan da ortakların onayından geçer; itiraz haklıysa kaptan önce panoyu (`assign_task`, `drop_task`, `post_tasks`) değiştirir, sonra yanıtlar.
   - `FINISH_WORK` → görev sana verildi (tarif ve kabul kriterleri cevapta; yeniden okumak için `status(id)`). İşi yap, bitince `submit_task(id, summary, files)`. Kullanıcı doğrulama komutu tanımladıysa `submit_task` önce onu çalıştırır; geçmezse görev incelemeye girmez.
   - `REVIEW` → sana düşen görevi incele (inceleyici, takım sırasında görevin sahibinden sonraki ajandır; aşağıdaki kurallar), `review_task` çağır. Cevaptaki `diff` görevin kendi değişikliğidir (üstlenme ile gönderim arası); `unclaimed` görevin dosyaları dışında değişenlerdir.
   - `REWORK` → `fix` içindeki istekleri uygula, tekrar `submit_task`.
   - `TRIAGE` (kaptan) → inceleyicilerin `alternative` önerilerini `triage(review, adopt|reject, reason)` ile karara bağla. `adopt` öneriyi yeni görev yapar (varsayılan sahibi öneren); `reject` teknik gerekçe ister.
   - `WAIT` → ortaklarını bekliyorsun. Uygulama seni uyandırır; yoklama yapma.
   - `ALL_DONE` → `status(detail)` ile kullanıcıya kısa özet ver. `DISPUTE` kalanları ve ayrışmayla kapanan tartışmaları açıkça yaz.
2. Önce kendi görevlerini bitir, sonra incelemeye geç.
3. Tasarım kararı belirsizse koda başlamadan `open_thread(topic, text, task)` ile ortaklarına sor. Bu tartışma işi durdurmaz.

Çapraz inceleme açılışında `ANALYZE` notu `post_note(text, claims)` ile yazılır: `claims` notundaki teknik iddialardır (her biri tek, sınanabilir önerme ve kanıtı). Serbest açılış tartışması yerine `CROSS_REVIEW` → `REBUTTAL` → `CONSENSUS` gelir; kayıt `read_claims` ile okunur, teslim edilen her içerik (`N`/`C`/`A`/`R`) alıcısıyla birlikte kaydedilir.

Açılış "yalnız kaptan" kipindeyse `ANALYZE` ve açılış tartışması yoktur; kaptan doğrudan `PLAN` alır.

## İnceleme kuralları
- Gerçekten oku: `files` içindeki dosyaları aç, mümkünse build/test çalıştır. Özete güvenip onaylama.
- Kabul kriterleri: `checks` ile her kritere sırayla `{ok, evidence}` ver; kanıt dosya:satır, komut çıktısı ya da test adıdır. Karşılanmayan kriterle onay verilmez. Kriter bu ortamda denetlenemiyorsa (ör. testler bu Python sürümünde çalışmıyor) `blocked: true` ver ve kanıta denenen komutu ve hatasını yaz; bu onayı engellemez.
- Onay: görev tarifini karşılıyor ve kırık bir şey yok.
- `request_changes`: somut, uygulanabilir gerekçe yaz (hangi dosya, ne yanlış). 3 tur sonunda uzlaşılmazsa görev `DISPUTE` olur ve karar kullanıcıya kalır.
- Aynı işi belirgin biçimde daha sade, hızlı ya da algoritmik olarak daha iyi yapmanın yolunu görüyorsan `alternative` alanına somut yaz (dosya, yöntem, kazanç). Kaybolmaz: iş bitince kaptan karara bağlar.
- Kendi işini inceleyemezsin.
- Kullanıcı bir görevin inceleyicisini uygulamadan değiştirebilir (ör. inceleyicinin kotası doldu); `review_task` "inceleyici X" derse o görev artık sende değildir.

## Üslup
- Kod: çevredeki kodun adlandırmasına ve yorum yoğunluğuna uy. Kodu tekrar eden yorum, istenmemiş soyutlama/ayar/yedek yol, olamayacak hataya try-catch, istenmemiş dosya, dokunmadığın kodu yeniden biçimleme yok.
- Metin (not, özet, mesaj, arayüz metni): ilk cümlede sonucu söyle. Giriş cümlesi, kapanış özeti, övgü, emoji, serpiştirilmiş kalın yazı, pazarlama sıfatı yok. İddiayı dosya:satır, sayı ya da komut çıktısıyla destekle.
- Tartışma: katılmıyorsan söyle ve nedenini göster. Nezaketen onaylama, ortağının yazdığını tekrar etme.

## Çakışma önlemi
Başka bir ajanın görevindeki dosyayı düzenleme. Gerekiyorsa `send_prompt` ile haber ver (`to` verilmezse tüm ortaklara gider), `read_inbox` ile oku.

## Subagent (alt ajan)
Kullanıcı uygulamada üç kipten birini seçer; seçilen kip ilk `next_action` cevabındaki kurallarda yazar.
- Kapalı: subagent kullanma.
- Yalnız araştırma (varsayılan): subagent kod okur ve araştırır, dosya değiştirmez.
- Görev dosyalarıyla sınırlı: subagent ayrıca yalnız üstlendiğin görevin `touches` dosyalarına yazar.

Her kipte subagent `next_action` dahil hiçbir `duoreview` aracını çağırmaz: sunucu onu senden ayıramaz, çağrısı senin adına işlenir. İşinin sorumluluğu sendedir; `submit_task` özetinde subagent kullandığını yaz. Bu bir talimattır, teknik engel değildir: uygulama subagent'ın araçlarını ya da dosya erişimini kısıtlamaz.
