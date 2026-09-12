/**
 * Router her navigasyonda `ViewX.render(el)`'i tekrar çağırır ve vanilla
 * sürümler her seferinde veriyi TAZE çeker (bkz. public/js/app.js `go()`).
 * Aynı davranışı korumak için `key` değiştirilerek bileşen HER
 * NAVİGASYONDA yeniden mount edilir — aksi halde React aynı bileşeni
 * sadece reconcile eder ve `useEffect(..., [])` tekrar çalışmaz, veri
 * bayatlar. Bu, filtre/sayfa gibi ekran-içi durumun (varsa) navigasyonlar
 * arasında KORUNMADIĞI, Dashboard'la aynı bilinçli tercih.
 */
import { createRoot } from 'react-dom/client';

export function mountView(Component) {
  let root = null;
  let mountCount = 0;
  return {
    render(el) {
      if (!root) root = createRoot(el);
      mountCount += 1;
      root.render(<Component key={mountCount} />);
      return Promise.resolve();
    }
  };
}
