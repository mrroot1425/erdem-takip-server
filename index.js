import express from 'express';
import cors from 'cors';
import {
  authHandlers, cariHandlers, siparisHandlers, fisHandlers,
  faturaHandlers, cekHandlers, puantajHandlers, ekstreHandlers, aramaHandlers
} from './db/database.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── API Key doğrulama ──────────────────────────────────────────────────────────
const API_KEY = process.env.API_KEY;
if (!API_KEY) { console.error('HATA: API_KEY env var tanımlanmamış!'); process.exit(1); }

app.use((req, res, next) => {
  if (req.path === '/health') return next();
  if (req.headers['x-api-key'] !== API_KEY) return res.status(401).json({ error: 'Yetkisiz erişim' });
  next();
});

app.get('/health', (_, res) => res.json({ ok: true }));

// Tüm handler'lar POST, data body'den geliyor
function r(handler) {
  return (req, res) => {
    try {
      const result = handler(req.body || {});
      res.json(result);
    } catch (e) {
      console.error(e.message);
      res.status(500).json({ error: e.message });
    }
  };
}

// Auth
app.post('/auth/login',                r(authHandlers.login));
app.post('/auth/changePassword',       r(authHandlers.changePassword));
app.post('/auth/getKullanicilar',      r(authHandlers.getKullanicilar));
app.post('/auth/saveKullanici',        r(authHandlers.saveKullanici));

// Cariler
app.post('/cari/getCariler',           r(cariHandlers.getCariler));
app.post('/cari/getCari',              r(cariHandlers.getCari));
app.post('/cari/saveCari',             r(cariHandlers.saveCari));
app.post('/cari/deleteCari',           r(cariHandlers.deleteCari));
app.post('/cari/getBakiye',            r(cariHandlers.getBakiye));
app.post('/cari/getAcikHesaplar',      r(cariHandlers.getAcikHesaplar));

// Siparişler
app.post('/siparis/getSiparisler',     r(siparisHandlers.getSiparisler));
app.post('/siparis/saveSiparis',       r(siparisHandlers.saveSiparis));
app.post('/siparis/deleteSiparis',     r(siparisHandlers.deleteSiparis));
app.post('/siparis/hizliDurumGuncelle',r(siparisHandlers.hizliDurumGuncelle));

// Fişler
app.post('/fis/getFisler',             r(fisHandlers.getFisler));
app.post('/fis/saveFis',               r(fisHandlers.saveFis));
app.post('/fis/deleteFis',             r(fisHandlers.deleteFis));
app.post('/fis/faturayaDonustur',      r(fisHandlers.faturayaDonustur));

// Faturalar
app.post('/fatura/getFaturalar',       r(faturaHandlers.getFaturalar));
app.post('/fatura/tahsilEt',           r(faturaHandlers.tahsilEt));

// Çekler
app.post('/cek/getCekler',             r(cekHandlers.getCekler));
app.post('/cek/saveCek',               r(cekHandlers.saveCek));
app.post('/cek/updateDurum',           r(cekHandlers.updateDurum));

// Puantaj
app.post('/puantaj/getIsciler',        r(puantajHandlers.getIsciler));
app.post('/puantaj/saveIsci',          r(puantajHandlers.saveIsci));
app.post('/puantaj/deleteIsci',        r(puantajHandlers.deleteIsci));
app.post('/puantaj/getPuantaj',        r(puantajHandlers.getPuantaj));
app.post('/puantaj/savePuantaj',       r(puantajHandlers.savePuantaj));
app.post('/puantaj/getAvanslar',       r(puantajHandlers.getAvanslar));
app.post('/puantaj/saveAvans',         r(puantajHandlers.saveAvans));
app.post('/puantaj/deleteAvans',       r(puantajHandlers.deleteAvans));

// Ekstre & Dashboard
app.post('/ekstre/getEkstre',              r(ekstreHandlers.getEkstre));
app.post('/ekstre/saveHareket',            r(ekstreHandlers.saveHareket));
app.post('/ekstre/deleteHareket',          r(ekstreHandlers.deleteHareket));
app.post('/ekstre/getDashboard',           r(ekstreHandlers.getDashboard));
app.post('/ekstre/getDashboardAksiyonlar', r(ekstreHandlers.getDashboardAksiyonlar));
app.post('/ekstre/getAylikCiro',           r(ekstreHandlers.getAylikCiro));

// Arama
app.post('/app/globalArama',           r(aramaHandlers.globalArama));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Erdem Takip Sunucu ayakta: http://localhost:${PORT}`));
