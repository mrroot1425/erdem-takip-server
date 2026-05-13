import express from 'express';
import cors from 'cors';
import {
  authHandlers, cariHandlers, siparisHandlers, fisHandlers,
  faturaHandlers, cekHandlers, puantajHandlers, ekstreHandlers, aramaHandlers,
  getDatabase
} from './db/database.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

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

// ── Veri Aktarımı (tek seferlik migration) ───────────────────────────────────
app.post('/admin/migrate', (req, res) => {
  const db = getDatabase();
  const { kullanicilar, cariler, cari_firma_ayarlari, siparisler, fisler,
          faturalar, cari_hareketler, isciler, puantaj, avanslar, cekler } = req.body;
  try {
    db.exec('PRAGMA foreign_keys = OFF');
    const ins = (table, cols, vals) => {
      if (!vals?.length) return;
      const placeholders = cols.map(() => '?').join(',');
      const stmt = db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`);
      for (const row of vals) stmt.run(cols.map(c => row[c] ?? null));
    };

    ins('kullanicilar', ['id','kullanici_adi','sifre_hash','ad_soyad','rol','aktif'], kullanicilar);
    ins('cariler', ['id','cari_kodu','firma_adi','yetkili','telefon','telefon2','mail','adres','vergi_dairesi','vergi_no','not_','aktif'], cariler);
    ins('cari_firma_ayarlari', ['id','cari_id','firma_id','calisma_tipi','odeme_vadesi','risk_limiti'], cari_firma_ayarlari);
    ins('siparisler', ['id','siparis_no','firma_id','cari_id','tarih','iplik_cinsi','iplik_acilimi','gelen_kg','bukum_miktari','tpm','bukum_yonu','kat_sayisi','recete_notu','istenen_termin','is_durumu','teslim_edilen_kg','fire_kg','birim_fiyat','not_'], siparisler);
    ins('fisler', ['id','fis_no','firma_id','cari_id','siparis_id','tarih','cikan_kg','birim_fiyat','tutar','irsaliye_no','faturaya_donustu','fatura_id','not_'], fisler);
    ins('faturalar', ['id','fatura_no','firma_id','cari_id','fatura_tarihi','toplam_kg','ara_toplam','kdv_orani','kdv_tutari','genel_toplam','vade_tarihi','odeme_durumu','tahsil_edilen','not_'], faturalar);
    ins('cari_hareketler', ['id','firma_id','cari_id','tarih','islem_tipi','belge_no','aciklama','borc','alacak','kg','vade_tarihi','odeme_sekli','referans_id','referans_tip','not_'], cari_hareketler);
    ins('isciler', ['id','firma_id','ad','soyad','giris_tarihi','baz_maas','yol_ucreti','yemek_ucreti','izin_hakki','aktif','not_'], isciler);
    ins('puantaj', ['id','isci_id','firma_id','yil','ay','devam_json','mesai_saat','mesai_ucret','banka_odeme','nakit_odeme','notlar'], puantaj);
    ins('avanslar', ['id','isci_id','firma_id','tarih','tutar','aciklama','not_'], avanslar);
    ins('cekler', ['id','cek_no','firma_id','cari_id','alinma_tarihi','vade_tarihi','tutar','banka','sube','kesideci','durum','not_'], cekler);

    db.exec('PRAGMA foreign_keys = ON');
    res.json({ success: true });
  } catch (e) {
    db.exec('PRAGMA foreign_keys = ON');
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Erdem Takip Sunucu ayakta: http://localhost:${PORT}`));
