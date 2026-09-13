// @ts-nocheck
/**
 * Playwright'ın webServer.command'ı bu dosyayı çalıştırır: globalSetup ile
 * webServer'ın başlatılma sırası garanti değil (bu ortamda webServer önce
 * başlayıp veritabanı dosyasını açık tuttuğu için globalSetup'ın rmSync'i
 * EPERM ile başarısız oldu) — bu yüzden silme işlemi, sunucuyu başlatan
 * AYNI process'in İÇİNDE, ondan hemen önce yapılıyor; sıralama garantili.
 */
const fs = require('fs');
const path = require('path');

fs.rmSync(path.join(__dirname, '..', '..', 'data'), { recursive: true, force: true });
require('../../server/index.js');
