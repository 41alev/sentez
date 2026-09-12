#!/usr/bin/env node
// @ts-nocheck
/**
 * Hızlı deneme başlatıcı: DEMO_DATA=1'i platform bağımsız şekilde ayarlayıp
 * sunucuyu başlatır. `DEMO_DATA=1 npm start` Unix kabuğuna özgüdür ve
 * Windows'ta (cmd/PowerShell) çalışmaz; bu script ikisinde de çalışır.
 *
 *   npm run demo
 *
 * Üretimde KULLANILMAZ — örnek firma ve şifresi README'de yazan beş demo
 * kullanıcı yükler.
 */
process.env.DEMO_DATA = '1';
require('../index.js');
