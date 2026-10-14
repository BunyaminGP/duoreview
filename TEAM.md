# Takım Protokolü (Claude + Codex + Gemini)

Bu projede `duoreview` MCP sunucusu üzerinden bir ya da iki ortağınla çalışıyorsun (takım ilk cevaptaki kurallarda yazar). Bu dosya geçerli olduğunda aşağıdaki akışı izle.

## Döngü
1. Göreve `next_action` ile başla. İlk cevapta rolün, kullanıcının talimatı ve kurallar gelir. Araç cevabında `next` alanı varsa sıradaki adım odur; yoksa `next_action` çağır. `action` ne diyorsa onu yap:
   - `ANALYZE` → talimatı kendi başına yerine getir (kodu oku, talimat istiyorsa internette araştır) ve bulgularını `post_note` ile yaz. Ortaklarını bekleme; notlar hepiniz yazana kadar birbirinizden gizlidir.
   - `DISCUSS` → gelen notu ve mesajları oku, `discuss(thread, stance, text)` ile yanıtla. Son öneriyi yazan dışında herkes `agree` deyince tartışma kapanır; söz takım sırasında döner; `object` gerekçe ister; `propose` yeni öneridir. Mesaj sınırı dolunca uzlaşma yoksa tartışma "ayrışma" olarak kapanır ve kullanıcıya gösterilir.
   - `PLAN` (kaptan) → notları ve tartışmayı birleştir, `post_tasks` ile işleri takımdaki ajanlara dengeli böl; başka görevin bitmesini bekleyen işe `depends_on` ver. İş çıkmıyorsa `post_tasks(tasks: [])`. Plan da ortakların onayından geçer.
   - `FINISH_WORK` → görev sana verildi (tarif cevapta; yeniden okumak için `status(id)`). İşi yap, bitince `submit_task(id, summary, files)`.
   - `REVIEW` → sana düşen görevi incele (inceleyici, takım sırasında görevin sahibinden sonraki ajandır; aşağıdaki kurallar), `review_task` çağır.
   - `REWORK` → `fix` içindeki istekleri uygula, tekrar `submit_task`.
   - `WAIT` → ortaklarını bekliyorsun. Uygulama seni uyandırır; yoklama yapma.
   - `ALL_DONE` → `status(detail)` ile kullanıcıya kısa özet ver. `DISPUTE` kalanları ve ayrışmayla kapanan tartışmaları açıkça yaz.
2. Önce kendi görevlerini bitir, sonra incelemeye geç.
3. Tasarım kararı belirsizse koda başlamadan `open_thread(topic, text, task)` ile ortaklarına sor. Bu tartışma işi durdurmaz.

Açılış "yalnız kaptan" kipindeyse `ANALYZE` ve açılış tartışması yoktur; kaptan doğrudan `PLAN` alır.

## İnceleme kuralları
- Gerçekten oku: `files` içindeki dosyaları aç, mümkünse build/test çalıştır. Özete güvenip onaylama.
- Onay: görev tarifini karşılıyor ve kırık bir şey yok.
- `request_changes`: somut, uygulanabilir gerekçe yaz (hangi dosya, ne yanlış). 3 tur sonunda uzlaşılmazsa görev `DISPUTE` olur ve karar kullanıcıya kalır.
- Aynı işi belirgin biçimde daha sade ya da hızlı yapmanın yolunu görüyorsan yoruma somut olarak yaz.
- Kendi işini inceleyemezsin.

## Üslup
- Kod: çevredeki kodun adlandırmasına ve yorum yoğunluğuna uy. Kodu tekrar eden yorum, istenmemiş soyutlama/ayar/yedek yol, olamayacak hataya try-catch, istenmemiş dosya, dokunmadığın kodu yeniden biçimleme yok.
- Metin (not, özet, mesaj, arayüz metni): ilk cümlede sonucu söyle. Giriş cümlesi, kapanış özeti, övgü, emoji, serpiştirilmiş kalın yazı, pazarlama sıfatı yok. İddiayı dosya:satır, sayı ya da komut çıktısıyla destekle.
- Tartışma: katılmıyorsan söyle ve nedenini göster. Nezaketen onaylama, ortağının yazdığını tekrar etme.

## Çakışma önlemi
Başka bir ajanın görevindeki dosyayı düzenleme. Gerekiyorsa `send_prompt` ile haber ver (`to` verilmezse tüm ortaklara gider), `read_inbox` ile oku.
