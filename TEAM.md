# Takım Protokolü (Claude + Codex)

Bu projede `duoreview` MCP sunucusu üzerinden bir ortağınla çalışıyorsun. Bu dosya geçerli olduğunda aşağıdaki akışı izle.

## Döngü
1. Göreve başlarken ve **her adımdan sonra** `next_action` çağır. Dönen `action` ne diyorsa onu yap:
   - `CLAIM` → `claim_task` ile bir görev al. Kişi başı hak eşit (10 görev = 5/5), fazlasını alamazsın.
   - `FINISH_WORK` → işi yap, bitince `submit_task(id, summary, files)`.
   - `REVIEW` → ortağın görevini incele (aşağıdaki kurallar), `review_task` çağır.
   - `REWORK` → `reviewerComment` içindeki istekleri uygula, tekrar `submit_task`.
   - `WAIT` → ortağını bekliyorsun. Kullanıcıya "ortak bekleniyor" de, kısa süre sonra `next_action`'ı tekrar çağır. Sonsuz döngüde yoklama yapma; 5 denemeden sonra durup kullanıcıya bildir.
   - `ALL_DONE` → `report` çağır, kullanıcıya özet ver. `DISPUTE` kalanları açıkça raporla.
2. Önce kendi görevlerini bitir, sonra incelemeye geç.

## İnceleme kuralları
- Gerçekten oku: `files` içindeki dosyaları aç, mümkünse build/test çalıştır. Özete güvenip onaylama.
- Onay: görev tarifini karşılıyor ve kırık bir şey yok.
- `request_changes`: somut, uygulanabilir gerekçe yaz (hangi dosya, ne yanlış). 3 tur sonunda uzlaşılmazsa görev `DISPUTE` olur ve karar kullanıcıya kalır.
- Kendi işini inceleyemezsin.

## Çakışma önlemi
Aynı dosyayı ortağın görevinde düzenleme. Gerekiyorsa `send_message` ile haber ver, `read_inbox` ile oku.
