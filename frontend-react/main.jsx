/**
 * React'e kademeli geçiş — giriş noktası.
 *
 * Bu dosya `public/index.html`'e `<script type="module">` olarak eklenir
 * (mevcut `ui.js`/`api.js`/`i18n.js`/`app.js` script'lerinden SONRA — onların
 * tanımladığı `window.UI`/`window.Api`/`window.I18N` global'lerine bağımlı).
 * `window.ViewDashboard` tanımlar; `public/js/app.js`'deki router hiç
 * değişmeden bunu diğer 9 view modülüyle (`ViewItems`, `ViewSales`, vb.)
 * AYNI ARAYÜZLE (`{ render(el) }`) çağırır.
 */
import { createRoot } from 'react-dom/client';
import DashboardView from './DashboardView.jsx';

let root = null;
let mountCount = 0;

window.ViewDashboard = {
  render(el) {
    if (!root) root = createRoot(el);
    // Router her navigasyonda render(el)'i tekrar çağırır ve orijinal
    // (vanilla) sürüm her seferinde veriyi TAZE çeker. Aynı davranışı
    // korumak için `key` değiştirilerek bileşen yeniden mount edilir —
    // aksi halde React aynı bileşeni sadece reconcile eder ve
    // useEffect(..., []) tekrar çalışmaz, veri bayatlar.
    mountCount += 1;
    root.render(<DashboardView key={mountCount} />);
    return Promise.resolve();
  }
};
