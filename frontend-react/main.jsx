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
import QualityView from './QualityView.jsx';
import SalesView from './SalesView.jsx';
import AdminView from './AdminView.jsx';

window.ViewDashboard = mountView(DashboardView);
window.ViewItems = mountView(ItemsView);
window.ViewCounts = mountView(CountsView);
// traceDialog kendi verisini kendi çeker (React ağacından bağımsız) —
// artık tüm çağıranlar da React'e taşındı, ama fonksiyon yine de bağımsız
// dışa aktarılıyor.
window.ViewLots = { ...mountView(LotsView), traceDialog };
window.ViewProduction = mountView(ProductionView);
window.ViewReports = mountView(ReportsView);
window.ViewPlanning = mountView(PlanningView);
window.ViewPurchasing = mountView(PurchasingView);
window.ViewQuality = mountView(QualityView);
window.ViewSales = mountView(SalesView);
window.ViewAdmin = mountView(AdminView);
