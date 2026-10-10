# InstaAuto — Kurulum, Mimari ve Problem Çözüm Rehberi (SETUP.md)

Bu doküman, `@yunusemrecelik.dev` Instagram hesabı için geliştirilen ve Vercel + Supabase üzerinde çalışan Instagram Otomasyon sisteminin (Next.js 16 + Meta Graph API) uçtan uca nasıl çalışır hale getirildiğini, karşılaşılan tüm kritik hataları ve çözümlerini detaylandırmaktadır.

---

## 1. Sistem Mimarisi ve Bileşenler

* **Frontend & Backend:** Next.js 16 (App Router, Turbopack, Serverless API Routes)
* **Hosting:** Vercel Production (`https://insta-p8-rho-puce.vercel.app`)
* **Veritabanı:** Supabase PostgreSQL (Kullanıcılar, Otomasyon kuralları, İletişim geçmişi)
* **Instagram Entegrasyonu:** Meta Instagram Graph API (`v24.0`)
* **Hesap ID:** `17841409192528567` (`@yunusemrecelik.dev`)
* **Meta App ID:** `1475200411246004` (Instagram App: `1074836935139590`)

---

## 2. Karşılaşılan Kritik Hatalar ve Çözüm Adımları

Sürecin başında projenin tamamen sıfırlanması düşünülmüş, ancak veritabanındaki 49 adet hazır otomasyon kuralı korunarak sistem yerinde teşhis edilmiş ve düzeltilmiştir.

### Hata 1: Yorum Webhook'larının Meta Tarafından Hiç Gönderilmemesi (KÖK SEBEP)
* **Sorun:** Kullanıcılar gönderilere veya Reels videolarına anahtar kelimeli yorum attığında sistem hiçbir tepki vermiyordu. Vercel loglarında gelen webhook isteği görünmüyordu.
* **Neden:** Meta Graph API `/{ig_user_id}/subscribed_apps` uç noktası sorgulandığında hesabın yalnızca `["messages"]` alanına abone olduğu, **`comments`** alanının abone yapılmadığı görüldü.
* **Çözüm:** Meta Graph API'ye doğrudan `POST` isteği atılarak hesap webhook alanlarına `comments` eklendi:
  ```http
  POST https://graph.instagram.com/v24.0/17841409192528567/subscribed_apps?subscribed_fields=comments,messages
  ```
  Meta doğrulaması: `{"data":[{"id":"18278759284306418","subscribed_fields":["comments","messages"]}]}`.

---

### Hata 2: Meta App "In Development / Unpublished" Mod Kısıtlaması
* **Sorun:** Webhook aktif edilmesine rağmen farklı bir test hesabından atılan yorumlar tetiklenmiyordu.
* **Neden:** Meta Developers uygulamasının **"Unpublished"** (Geliştirici) modunda olması sebebiyle, Meta yalnızca **App Roles -> Instagram Testers** listesinde yer alan ve daveti Instagram uygulamasından kabul eden hesapların isteklerini iletmektedir. Harici hesapların yorumları güvenlik gereği sessizce düşürülür.
* **Çözüm:** 
  1. Test edilen Instagram hesabı Meta Developer Console'da **Instagram Tester** olarak eklendi.
  2. Instagram mobil uygulamasından (`Ayarlar -> Güvenlik -> Web Sitesi İzinleri -> Test Kullanıcısı Davetleri`) davet onaylandı.
  3. Uygulama ayarlarında Gizlilik Politikası (`/privacy`) ve temel bilgiler tamamlanarak canlı yayın hazırlığı yapıldı.

---

### Hata 3: Dashboard ve Otomasyonlarda 500 Hatası (Supabase & Cookie Senkronizasyonu)
* **Sorun:** Dashboard üzerinde sol altta kullanıcı adı görünmüyor (`api/auth/me: 500`), yeni kural eklenirken `foreign key constraint "automations_user_id_fkey"` hatası alınıyordu.
* **Neden:**
  - Supabase `users` tablosunda `profile_picture_url` kolonu bulunmadığı için yapılan sorgu SQL 500 hatası veriyordu.
  - Tarayıcı `localStorage` temizlendiğinde oturum kopuyor ve otomasyon ekleme istekleri geçersiz kullanıcı ID'siyle veritabanına gidiyordu.
* **Çözüm:**
  - `app/api/auth/me/route.ts` optimize edildi, eksik kolon sorguları kaldırıldı.
  - `hooks/use-instagram-session.ts` kancası sunucu taraflı `/api/auth/me` uç noktasını okuyacak şekilde güncellendi; tarayıcı yenilense dahi canlı `@yunusemrecelik.dev` oturumu otomatik yüklendi.
  - `app/api/automations/route.ts` içine kullanıcı eşleme ve yabancı anahtar (Foreign Key) koruması eklendi.

---

### Hata 4: Webhook İçi Token Çözümleme ve API Çağrısı Başarısızlığı
* **Sorun:** Webhook tetiklendiğinde `400 {"error":{"message":"Invalid OAuth access token"}}` veya yetkisiz erişim logları oluşuyordu.
* **Neden:** `graph.facebook.com` yerine Instagram Business için doğrudan `graph.instagram.com` kullanılması gerekiyordu ve veritabanındaki oturum tokenı bazen süresi dolmuş veya geçersiz kalabiliyordu.
* **Çözüm:**
  - `app/api/instagram/webhook/route.ts` içine güvenli canlı token yedeklemesi (Fallback Token Safeguard) entegre edildi.
  - Yorumlara halka açık yanıt (`replyToComment`) ve DM gönderimi (`sendTextDM` / `sendCardDM`) uçtan uca test edilip doğrulandı.

---

## 3. Webhook Akışı Nasıl Çalışıyor?

1. **Tetikleyici (Trigger):** Kullanıcı bir gönderiye veya Reels videosuna yorum atar (Örn: `skill`).
2. **Meta Webhook İletimi:** Meta, Vercel üzerindeki `POST https://insta-p8-rho-puce.vercel.app/api/instagram/webhook` adresine `x-hub-signature-256` imzalı JSON gönderir.
3. **İmza Doğrulama:** `APP_SECRETS` (Meta & Instagram Secret) ile HMAC-SHA256 kontrol edilir.
4. **Kural Eşleştirme:** Supabase `automations` tablosundaki aktif kurallar taranır. Regex ve anahtar kelime eşleşmesi (`keywordMatches`) yapılır.
5. **Aksiyon:**
   - Gönderinin altına rastgele belirlenen bir mesajla yanıt verilir (`DEFAULT_PUBLIC_REPLIES` veya özel havuz).
   - Kullanıcıya Instagram Direct üzerinden otomasyonda tanımlı DM kartı veya metni iletilir.

---

## 4. Canlı Ortam Kontrol Komutları

* **Vercel Canlı Loglarını İzleme:**
  ```bash
  vercel logs https://insta-p8-rho-puce.vercel.app -n 50
  ```
* **Instagram Webhook Abonelik Durumunu Sorgulama:**
  ```bash
  curl -X GET "https://graph.instagram.com/v24.0/17841409192528567/subscribed_apps?access_token={TOKEN}"
  ```
* **Webhooks Uç Noktasına Manuel Test Gönderme:**
  `lib/instagram-api.ts` ve webhook test scriptleri kullanılarak imza ile simüle edilebilir.

---
*Tarih: Ekim 2026 | Hazırlayan: Antigravity Assistant & Yunus Emre Çelik*
