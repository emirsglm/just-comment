# Yorum Toplayıcı — Yerel Web Test Notları

Canlı bir web sitesinde test yaparken tıkladığın komponentin **ekran görüntüsünü**,
**yorumunu** ve **element bilgisini** otomatik toplayan Chrome eklentisi (Manifest V3).

**Hiçbir veri dışarı gönderilmez.** Eklentide tek bir `fetch`/`XHR` çağrısı yoktur,
harici kütüphane veya CDN kullanılmaz, `host_permissions` tanımlı değildir. Her şey
`chrome.storage.local` içinde, yalnızca bu bilgisayarda durur (`chrome.storage.sync`
bilinçli olarak **kullanılmamıştır** — o Google hesabına senkronize olurdu).

## Kurulum (Load unpacked)

1. Chrome'da adres çubuğuna `chrome://extensions` yaz ve Enter'a bas.
2. Sağ üstteki **Geliştirici modu** (Developer mode) anahtarını aç.
3. Sol üstte çıkan **Paketlenmemiş öğe yükle** (Load unpacked) düğmesine tıkla.
4. Bu klasörü (`manifest.json` dosyasının bulunduğu klasörü) seç.
5. Eklenti listede belirir. Araç çubuğunda görünmesi için puzzle (🧩) ikonuna tıklayıp
   "Yorum Toplayıcı"yı sabitle (pin).

Kodda değişiklik yaptığında `chrome://extensions` sayfasındaki yenile (⟳) ikonuna basman
ve test ettiğin sekmeyi yenilemen yeterli.

## Kullanım

1. Test etmek istediğin siteyi aç (http/https olmalı).
2. Araç çubuğundaki eklenti ikonuna tıkla → **"Yorum modunu aç"**.
   > Manifest V3'te ikon bir popup açtığı için aç/kapat düğmesi popup'ın içindedir;
   > aynı düğme modu kapatmak için de kullanılır. Sayfada **Esc** de modu kapatır.
3. Popup'ı kapat. Artık fare ile gezdiğin her element **kırmızı çerçeveyle** vurgulanır
   ve tıklamalar sayfanın kendi davranışını tetiklemez.
4. Bir komponente tıkla → ekran görüntüsü alınır, tıklanan eleman görüntü üzerinde
   kırmızı kutuyla işaretlenir ve yorum kutusu açılır.
5. Yorumunu yazıp **Kaydet**'e bas. Kayıt şunları içerir:
   `{ tarih-saat, sayfa URL'si, CSS selector, element bilgisi, ekran görüntüsü (base64), yorum }`
6. Popup'tan **Raporu İndir** ile tek parça, offline açılabilen bir HTML dosyası al;
   **Tümünü Temizle** ile depoyu sıfırla.

## Dosyalar

| Dosya | Görevi |
|---|---|
| `manifest.json` | MV3 tanımı, asgari izinler (`activeTab`, `scripting`, `storage`, `downloads`) |
| `background.js` | Service worker: content script enjeksiyonu, ekran görüntüsü, kayıt |
| `content.js` | Hover highlight, tıklama yakalama, selector üretimi, işaretleme, yorum kutusu |
| `content.css` | Shadow DOM host'unun sayfadan izole edilmesi |
| `popup.html/js/css` | Yorum listesi, HTML rapor üretimi, temizleme |

Content script manifest'te `content_scripts` ile **her siteye otomatik enjekte edilmez**;
yalnızca sen yorum modunu açtığında `chrome.scripting.executeScript` ile o sekmeye
enjekte edilir. Bu yüzden `host_permissions` gerekmez.

## Ekran görüntüsü: neden `captureVisibleTab`, neden html2canvas değil

`chrome.tabs.captureVisibleTab` kullanıldı. Gerekçe:

- **Doğruluk:** Tarayıcının kendi compositor çıktısıdır — sayfada ne görüyorsan o çıkar.
  html2canvas sayfayı CSS'ten yeniden çizmeye çalışır; `<canvas>`, `<iframe>`, gölge DOM,
  web font, CSS filter/mask, `background-clip` gibi yapılarda düzenli olarak bozulur.
- **CSP:** html2canvas ara adımda SVG `foreignObject` → data URL → `<img>` yolu kullanır.
  Katı `img-src`/`style-src` politikası olan sitelerde bu adım engellenir.
  `captureVisibleTab` sayfa CSP'sinden tamamen bağımsızdır.
- **Bağımlılık yok:** ~250 KB'lık bir kütüphaneyi paketlemeye gerek kalmaz; ağ isteği
  yapmama garantisi kod okunarak doğrulanabilir kalır.

Görüntü üzerindeki kırmızı işaret kutusu, yakalanan görüntü yerel bir `<canvas>`
üzerine çizildikten sonra `strokeRect` ile ekleniyor (`content.js` → `annotate`).

## Bilinen kısıtlar

- **Yalnızca görünür alan.** `captureVisibleTab` viewport'u yakalar; sayfanın tamamını
  değil. Kutu ekranın dışında kalıyorsa önce o noktaya kaydır.
- **Yasaklı sayfalar.** `chrome://`, `chrome-extension://`, Chrome Web Store ve
  `view-source:` sayfalarına hiçbir eklenti enjekte edilemez. Popup bu durumda uyarır.
- **`file://` sayfaları.** Çalışması için `chrome://extensions` → eklenti detayı →
  "Dosya URL'lerine erişime izin ver" seçeneğini açman gerekir.
- **`activeTab` ömrü.** İzin, ikona tıkladığında verilir ve sekme başka bir adrese
  gidene kadar sürer. Sayfayı yenilersen yorum modunu tekrar açman gerekir.
- **Cross-origin iframe içeriği.** Yorum modu üst dokümanda çalışır; farklı kaynaklı
  bir iframe'in içindeki elemanlar için selector üretilemez (iframe'in kendisi seçilir).
  Ekran görüntüsünde iframe içeriği yine de görünür.
- **Depolama kotası.** `chrome.storage.local` `unlimitedStorage` olmadan ~10 MB'dır.
  Görüntüler bu yüzden JPEG (kalite ~0.8) olarak ve en fazla 1400 px genişlikte
  saklanıyor; kaba hesapla birkaç yüz yorum sığar. Kota dolduğunda yorum kutusu hata
  gösterir — raporu indirip listeyi temizle.
- **Selector kırılganlığı.** Üretilen selector `id > tag+class > nth-child` sırasıyla,
  yakalandığı andaki DOM'a göre benzersiz olacak şekilde seçilir. Hash'li/üretilmiş
  class adları (CSS Modules, Tailwind JIT, styled-components) kullanan sitelerde bu
  selector bir sonraki derlemede geçersiz olabilir.
- **Sayfanın kendi kısayolları.** Fare olayları capture fazında yutulur, ancak sayfa
  `keydown` dinleyicileriyle hâlâ tepki verebilir; yorum modundayken klavye kullanma.
