// @ts-nocheck
import { mountView } from '../mountView.jsx';
import LotsView, { traceDialog } from '../LotsView.jsx';

// traceDialog kendi verisini kendi çeker (React ağacından bağımsız) ve
// SalesView/QualityView/ProductionView'dan `window.traceLot()` üzerinden
// (bkz. public/js/app.js) çağrılıyor — bu paket henüz yüklenmemiş olabilir,
// app.js gerekirse önce bu script'i yükleyip sonra bu fonksiyonu çağırır.
window.ViewLots = { ...mountView(LotsView), traceDialog };
