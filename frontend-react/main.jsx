/**
 * React'e kademeli geçiş — giriş noktası.
 *
 * Bu dosya `public/index.html`'e `<script type="module">` olarak eklenir
 * (mevcut `ui.js`/`api.js`/`i18n.js`/`app.js` script'lerinden SONRA — onların
 * tanımladığı `window.UI`/`window.Api`/`window.I18N` global'lerine bağımlı).
 * `window.ViewDashboard`/`window.ViewItems` tanımlar; `public/js/app.js`'deki
 * router hiç değişmeden bunları diğer view modülleriyle (`ViewSales`, vb.)
 * AYNI ARAYÜZLE (`{ render(el) }`) çağırır.
 */
import { mountView } from './mountView.jsx';
import DashboardView from './DashboardView.jsx';
import ItemsView from './ItemsView.jsx';

window.ViewDashboard = mountView(DashboardView);
window.ViewItems = mountView(ItemsView);
