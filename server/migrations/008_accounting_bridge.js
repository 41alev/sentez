// @ts-nocheck
/**
 * Genel muhasebe dışa aktarım köprüsü.
 *
 * Bu sistem bir muhasebe programı DEĞİL — rakiplerin (Logo/Netsis/Mikro)
 * hepsi önce muhasebe programı, üretim/depo sonradan eklenmiş. Bu sistemin
 * "tek sistem" olamamasının tek nedeni muhasebeye hiç köprü olmaması.
 *
 * Hangi muhasebe programının seçileceği belli olmadığı için (kullanıcı
 * "genel" seçeneğini onayladı) belirli bir programa özel format YAZILMADI.
 * Bunun yerine Türkiye'de yaygın "tekdüzen hesap planı" numaralarına
 * dayalı, hesap kodu eşlemesi AYARLARDAN değiştirilebilen bir yevmiye
 * (muhasebe fişi) satırı üretici kuruldu. Hangi program seçilirse seçilsin,
 * yalnızca bu tablodaki kodlar o programın hesap planına göre güncellenir.
 */
module.exports = {
  name: 'accounting export bridge',
  up(db) {
    db.exec(`
      CREATE TABLE account_code_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL DEFAULT 1,
        -- sales_revenue | sales_vat | accounts_receivable | purchase_vat |
        -- accounts_payable | inventory
        mapping_key TEXT NOT NULL,
        account_code TEXT NOT NULL,
        account_name TEXT NOT NULL,
        UNIQUE(company_id, mapping_key)
      );
      CREATE INDEX idx_accmap_company ON account_code_mappings(company_id);
    `);

    // Tekdüzen hesap planı varsayılanları — herhangi bir programa geçişte
    // yalnızca kod/ad güncellenir, üretici mantığı hiç değişmez.
    const defaults = [
      ['sales_revenue', '600', 'Yurtiçi Satışlar'],
      ['sales_vat', '391', 'Hesaplanan KDV'],
      ['accounts_receivable', '120', 'Alıcılar'],
      ['purchase_vat', '191', 'İndirilecek KDV'],
      ['accounts_payable', '320', 'Satıcılar'],
      ['inventory', '153', 'Ticari Mallar']
    ];
    const ins = db.prepare(
      'INSERT INTO account_code_mappings (company_id, mapping_key, account_code, account_name) VALUES (1,?,?,?)'
    );
    defaults.forEach(([key, code, name]) => ins.run(key, code, name));
  }
};
