# Dünya Stratejisi — Android (HTML5 + Capacitor)

Altı çağlı (Orta Çağ, Napolyon/Sömürge, 1. DS, 2. DS, Soğuk Savaş, Modern Dünya), 2D kuşbakışı, yatay modda, dokunmatik dünya strateji oyunu.

**Teknoloji:** HTML5 Canvas + saf JavaScript (kütüphane yok) → **Capacitor 6** ile Android APK.

## Dosya yapısı
```
DunyaStratejisi/
├─ package.json            Capacitor bağımlılıkları ve komutlar
├─ capacitor.config.json   Uygulama adı/kimliği, web klasörü (www)
├─ scripts/patch-android.js  Yatay mod + tam ekran ayarı
├─ .github/workflows/build-apk.yml  Ücretsiz bulutta APK derleme
└─ www/
   ├─ index.html
   ├─ css/style.css
   └─ js/
      ├─ data.js    Eyaletler, çağlar, ülkeler, teknolojiler
      ├─ land.js    Kıta kenar çizgileri (harita şekli)
      ├─ engine.js  Ekonomi, savaş, ikmal, diplomasi, yapay zekâ
      └─ ui.js      Ekranlar, harita çizimi, dokunma, pencereler
```

## 0) Önce tarayıcıda deneyin (APK gerekmez)
```
cd DunyaStratejisi
npx serve www      # veya: python3 -m http.server 8080 --directory www
```
Chrome'da açın, F12 → cihaz simülasyonu → yatay (landscape) seçin.

## Yöntem A — Bilgisayarsız / kurulumsuz: GitHub Actions (ücretsiz, önerilen)
1. github.com'da ücretsiz hesap açın, **New repository** ile boş bir depo oluşturun.
2. Bu klasörün **tüm içeriğini** (gizli `.github` klasörü dahil) depoya yükleyin (Upload files veya git push).
3. Depoda **Actions** sekmesi → **APK Derle** → **Run workflow**. (main'e her push'ta da otomatik çalışır.)
4. İş yeşil tamamlanınca (~5-8 dk) çalıştırmaya girin, altta **Artifacts → dunya-stratejisi-apk** dosyasını indirin, zip'ten `app-debug.apk` çıkar.
5. APK'yı telefona atın, **Bilinmeyen kaynaklardan yüklemeye izin verin** ve kurun.

## Yöntem B — Bilgisayarda Android Studio
Gerekenler: Node.js 20+, JDK 17, Android Studio (SDK'sı ile).
```
cd DunyaStratejisi
npm install
npx cap add android
node scripts/patch-android.js
npx cap sync android
npx cap open android
```
Android Studio'da Gradle senkronu bitince: **Build → Build Bundle(s)/APK(s) → Build APK(s)**.
APK: `android/app/build/outputs/apk/debug/app-debug.apk`

Komut satırından: `cd android && ./gradlew assembleDebug` (Windows: `gradlew.bat assembleDebug`). `ANDROID_HOME` tanımlı olmalı.

## Kod değiştirince
`www/` içini düzenleyin, sonra `npx cap sync android` ve yeniden derleyin (Yöntem A'da sadece push edin).

## Play Store / imzalı sürüm
Debug APK sadece kendi cihazlarınız içindir. Yayın için Android Studio → **Build → Generate Signed Bundle/APK** ile kendi anahtarınızı (keystore) oluşturup `.aab` üretin. Anahtarı kaybetmeyin.

## Sorun giderme
- *Ekran dikey kalıyor:* `node scripts/patch-android.js` komutunu `cap add android`'den sonra çalıştırdınız mı?
- *Gradle "Java 17 required":* JDK 17 kurun, `JAVA_HOME`'u ayarlayın.
- *Beyaz ekran:* `npx cap sync android` yapıp temiz derleyin.
- *Kayıt:* oyun `localStorage`'a kaydeder (8 turda bir otomatik).

## Özelleştirme
- Yeni ülke/çağ: `www/js/data.js` → `ERAS` içinde `[id, ad, başkent, [eyaletler], ekonomi, askeri]`.
- Eyalet ekle/değiştir: `RAW_PROVS` (boylam, enlem, yarıçap, nüfus, zenginlik, hammadde, arazi).
- Denge: `engine.js` → `income()`, `move()`, `aiTurn()`.
