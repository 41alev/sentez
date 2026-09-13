// @ts-nocheck
/**
 * Etiket yazdırma diyaloğu — Items ve Lots ekranları arasında paylaşılan,
 * React durumundan bağımsız bir yardımcı (UI.modal() global overlay
 * sistemini kullanıyor, herhangi bir view'ın React ağacına bağlı değil).
 */

export function openLabelPrintDialog(type, id, title) {
  const { t, field, input, intVal } = UI;
  UI.modal({
    title: UI.getLang() === 'tr' ? 'Etiket Yazdır' : 'Print Label',
    sub: title || '',
    body: `
      ${field(UI.getLang() === 'tr' ? 'Kopya sayısı' : 'Copies', input('lblCopies', { type: 'number', min: 1, max: 50, value: 1 }))}
      <div class="alert info">${UI.getLang() === 'tr'
        ? 'Ağ üzerinden Zebra yazıcıya doğrudan gönderilir (Yönetim > Ayarlar\'da yazıcı IP\'si tanımlı olmalı). Yazıcınız yoksa ham ZPL dosyasını indirip başka bir yolla (USB/paylaşım) gönderebilirsiniz.'
        : 'Sends directly to a networked Zebra printer (configure the printer IP under Admin > Settings). Without one, download the raw ZPL file and send it another way (USB/share).'}</div>`,
    footer: `<button class="btn btn-ghost" data-close>${t('cancel')}</button>
             <button class="btn btn-ghost" id="lblZpl">${UI.icon(UI.ICONS.download)}${UI.getLang() === 'tr' ? 'ZPL indir' : 'Download ZPL'}</button>
             <button class="btn btn-primary" id="lblGo">${UI.getLang() === 'tr' ? 'Yazdır' : 'Print'}</button>`,
    onOpen: (box) => {
      box.querySelector('#lblZpl').onclick = async () => {
        try { await Api.downloadLabelZpl(type, id); } catch (e) { UI.err(e); }
      };
      box.querySelector('#lblGo').onclick = async () => {
        try {
          await Api.printLabel({ type, id, copies: intVal('lblCopies') });
          UI.ok(UI.getLang() === 'tr' ? 'Yazıcıya gönderildi.' : 'Sent to printer.');
          UI.closeModal();
        } catch (e) { UI.err(e); }
      };
    }
  });
}
