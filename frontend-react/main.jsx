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
import CountsView from './CountsView.jsx';
import LotsView, { traceDialog } from './LotsView.jsx';
import ProductionView from './ProductionView.jsx';
import ReportsView from './ReportsView.jsx';
import PlanningView from './PlanningView.jsx';
import PurchasingView from './PurchasingView.jsx';

window.ViewDashboard = mountView(DashboardView);
window.ViewItems = mountView(ItemsView);
window.ViewCounts = mountView(CountsView);
// traceDialog kendi verisini kendi çeker (React ağacından bağımsız) —
// hâlâ vanilla olan sales.js/quality.js bunu doğrudan
// `ViewLots.traceDialog(lotId)` olarak çağırıyor.
window.ViewLots = { ...mountView(LotsView), traceDialog };
window.ViewProduction = mountView(ProductionView);
window.ViewReports = mountView(ReportsView);
window.ViewPlanning = mountView(PlanningView);
window.ViewPurchasing = mountView(PurchasingView);
