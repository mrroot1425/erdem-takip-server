import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeDatabase } from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fix(obj) {
  if (!obj) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === 'bigint' ? Number(v) : v;
  }
  return out;
}
function fixAll(arr) { return arr.map(fix); }

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../erdem-takip.db');

let db;
export function getDatabase() {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    initializeDatabase(db);
  }
  return db;
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
export const authHandlers = {
  login: (data) => {
    const { kullanici_adi, sifre } = data;
    const user = getDatabase().prepare(
      'SELECT * FROM kullanicilar WHERE kullanici_adi = ? AND sifre_hash = ? AND aktif = 1'
    ).get(kullanici_adi, sifre);
    if (!user) return { success: false, message: 'Kullanıcı adı veya şifre hatalı' };
    const { sifre_hash, ...safeUser } = fix(user);
    return { success: true, user: safeUser };
  },

  changePassword: (data) => {
    const { id, eski_sifre, yeni_sifre } = data;
    const user = fix(getDatabase().prepare('SELECT * FROM kullanicilar WHERE id = ? AND sifre_hash = ?').get(id, eski_sifre));
    if (!user) return { success: false, message: 'Eski şifre hatalı' };
    getDatabase().prepare('UPDATE kullanicilar SET sifre_hash = ? WHERE id = ?').run(yeni_sifre, id);
    return { success: true };
  },

  getKullanicilar: () => fixAll(getDatabase().prepare(
    'SELECT id, kullanici_adi, ad_soyad, rol, aktif FROM kullanicilar'
  ).all()),

  saveKullanici: (data) => {
    const db = getDatabase();
    if (data.id) {
      db.prepare('UPDATE kullanicilar SET ad_soyad=?, rol=?, aktif=? WHERE id=?')
        .run(data.ad_soyad, data.rol, data.aktif, data.id);
    } else {
      db.prepare('INSERT INTO kullanicilar (kullanici_adi, sifre_hash, ad_soyad, rol) VALUES (?,?,?,?)')
        .run(data.kullanici_adi, data.sifre || '1234', data.ad_soyad, data.rol);
    }
    return { success: true };
  }
};

// ─── CARİLER ──────────────────────────────────────────────────────────────────
export const cariHandlers = {
  getCariler: (data) => {
    const { firma_id, calisma_tipi } = data || {};
    const db = getDatabase();
    if (firma_id) {
      const params = [firma_id];
      let where = 'WHERE c.aktif = 1';
      if (calisma_tipi) { where += ' AND cfa.calisma_tipi = ?'; params.push(calisma_tipi); }
      return fixAll(db.prepare(`
        SELECT c.*, cfa.calisma_tipi, cfa.odeme_vadesi, cfa.risk_limiti
        FROM cariler c
        LEFT JOIN cari_firma_ayarlari cfa ON c.id = cfa.cari_id AND cfa.firma_id = ?
        ${where} ORDER BY c.firma_adi
      `).all(...params));
    }
    return fixAll(db.prepare('SELECT * FROM cariler WHERE aktif = 1 ORDER BY firma_adi').all());
  },

  getCari: (data) => fix(getDatabase().prepare('SELECT * FROM cariler WHERE id = ?').get(data.id || data)),

  saveCari: (data) => {
    const db = getDatabase();
    let cari_id = data.id;
    if (data.id) {
      db.prepare(`UPDATE cariler SET cari_kodu=?, firma_adi=?, yetkili=?, telefon=?, telefon2=?,
        mail=?, adres=?, vergi_dairesi=?, vergi_no=?, not_=? WHERE id=?`)
        .run(data.cari_kodu, data.firma_adi, data.yetkili, data.telefon, data.telefon2,
          data.mail, data.adres, data.vergi_dairesi, data.vergi_no, data.not_, data.id);
    } else {
      const result = db.prepare(`INSERT INTO cariler (cari_kodu, firma_adi, yetkili, telefon, telefon2,
        mail, adres, vergi_dairesi, vergi_no, not_) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(data.cari_kodu, data.firma_adi, data.yetkili, data.telefon, data.telefon2,
          data.mail, data.adres, data.vergi_dairesi, data.vergi_no, data.not_);
      cari_id = Number(result.lastInsertRowid);
    }
    if (data.firma_id) {
      db.prepare(`INSERT INTO cari_firma_ayarlari (cari_id, firma_id, calisma_tipi, odeme_vadesi, risk_limiti)
        VALUES (?,?,?,?,?) ON CONFLICT(cari_id, firma_id) DO UPDATE SET
        calisma_tipi=excluded.calisma_tipi, odeme_vadesi=excluded.odeme_vadesi, risk_limiti=excluded.risk_limiti`)
        .run(cari_id, data.firma_id, data.calisma_tipi || 'acik_hesap', data.odeme_vadesi || 30, data.risk_limiti || 0);
    }
    return { success: true, id: cari_id };
  },

  deleteCari: (data) => {
    getDatabase().prepare('UPDATE cariler SET aktif = 0 WHERE id = ?').run(data.id || data);
    return { success: true };
  },

  getBakiye: (data) => {
    const { cari_id, firma_id } = data;
    return fix(getDatabase().prepare(`
      SELECT COALESCE(SUM(borc),0) as toplam_borc, COALESCE(SUM(alacak),0) as toplam_alacak,
             COALESCE(SUM(borc),0) - COALESCE(SUM(alacak),0) as bakiye
      FROM cari_hareketler WHERE cari_id = ? AND firma_id = ?
    `).get(cari_id, firma_id)) || { toplam_borc: 0, toplam_alacak: 0, bakiye: 0 };
  },

  getAcikHesaplar: (data) => {
    return fixAll(getDatabase().prepare(`
      SELECT c.*,
        COALESCE(SUM(ch.borc),0) as toplam_borc, COALESCE(SUM(ch.alacak),0) as toplam_alacak,
        COALESCE(SUM(ch.borc),0) - COALESCE(SUM(ch.alacak),0) as bakiye,
        MIN(CASE WHEN ch.borc > 0 THEN ch.tarih END) as en_eski_borc_tarihi
      FROM cariler c
      JOIN cari_hareketler ch ON c.id = ch.cari_id AND ch.firma_id = ?
      WHERE c.aktif = 1 GROUP BY c.id HAVING bakiye > 0 ORDER BY bakiye DESC
    `).all(data.firma_id));
  }
};

// ─── SİPARİŞLER ───────────────────────────────────────────────────────────────
export const siparisHandlers = {
  getSiparisler: (data) => {
    const { firma_id, cari_id, durum, baslangic, bitis } = data || {};
    let q = `SELECT s.*, c.firma_adi as cari_adi FROM siparisler s
             JOIN cariler c ON s.cari_id = c.id WHERE s.firma_id = ?`;
    const params = [firma_id];
    if (cari_id) { q += ' AND s.cari_id = ?'; params.push(cari_id); }
    if (durum) { q += ' AND s.is_durumu = ?'; params.push(durum); }
    if (baslangic) { q += ' AND s.tarih >= ?'; params.push(baslangic); }
    if (bitis) { q += ' AND s.tarih <= ?'; params.push(bitis); }
    return fixAll(getDatabase().prepare(q + ' ORDER BY s.tarih DESC').all(...params));
  },

  saveSiparis: (data) => {
    const db = getDatabase();
    if (data.id) {
      db.prepare(`UPDATE siparisler SET cari_id=?, tarih=?, iplik_cinsi=?, iplik_acilimi=?,
        gelen_kg=?, bukum_miktari=?, tpm=?, bukum_yonu=?, kat_sayisi=?, recete_notu=?,
        istenen_termin=?, is_durumu=?, teslim_edilen_kg=?, fire_kg=?, birim_fiyat=?, not_=?
        WHERE id=? AND firma_id=?`)
        .run(data.cari_id, data.tarih, data.iplik_cinsi, data.iplik_acilimi, data.gelen_kg,
          data.bukum_miktari, data.tpm, data.bukum_yonu, data.kat_sayisi, data.recete_notu,
          data.istened_termin, data.is_durumu, data.teslim_edilen_kg, data.fire_kg,
          data.birim_fiyat, data.not_, data.id, data.firma_id);
    } else {
      db.prepare(`INSERT INTO siparisler (siparis_no, firma_id, cari_id, tarih, iplik_cinsi, iplik_acilimi,
        gelen_kg, bukum_miktari, tpm, bukum_yonu, kat_sayisi, recete_notu, istenen_termin,
        is_durumu, teslim_edilen_kg, fire_kg, birim_fiyat, not_) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(`S-${Date.now()}`, data.firma_id, data.cari_id, data.tarih, data.iplik_cinsi, data.iplik_acilimi,
          data.gelen_kg, data.bukum_miktari, data.tpm, data.bukum_yonu, data.kat_sayisi,
          data.recete_notu, data.istenen_termin, data.is_durumu || 'beklemede',
          data.teslim_edilen_kg || 0, data.fire_kg || 0, data.birim_fiyat, data.not_);
    }
    return { success: true };
  },

  deleteSiparis: (data) => {
    getDatabase().prepare('DELETE FROM siparisler WHERE id = ?').run(data.id || data);
    return { success: true };
  },

  hizliDurumGuncelle: (data) => {
    getDatabase().prepare('UPDATE siparisler SET is_durumu=? WHERE id=? AND firma_id=?')
      .run(data.is_durumu, data.id, data.firma_id);
    return { success: true };
  }
};

// ─── FİŞLER ───────────────────────────────────────────────────────────────────
export const fisHandlers = {
  getFisler: (data) => {
    const { firma_id, cari_id, faturasiz, baslangic, bitis } = data || {};
    let q = `SELECT f.*, c.firma_adi as cari_adi, s.siparis_no
             FROM fisler f JOIN cariler c ON f.cari_id = c.id
             LEFT JOIN siparisler s ON f.siparis_id = s.id WHERE f.firma_id = ?`;
    const params = [firma_id];
    if (cari_id) { q += ' AND f.cari_id = ?'; params.push(cari_id); }
    if (faturasiz) { q += ' AND f.faturaya_donustu = 0'; }
    if (baslangic) { q += ' AND f.tarih >= ?'; params.push(baslangic); }
    if (bitis) { q += ' AND f.tarih <= ?'; params.push(bitis); }
    return fixAll(getDatabase().prepare(q + ' ORDER BY f.tarih DESC').all(...params));
  },

  saveFis: (data) => {
    const db = getDatabase();
    const tutar = (data.cikan_kg || 0) * (data.birim_fiyat || 0);
    if (data.id) {
      db.prepare(`UPDATE fisler SET cari_id=?, siparis_id=?, tarih=?, cikan_kg=?, birim_fiyat=?,
        tutar=?, irsaliye_no=?, not_=? WHERE id=? AND firma_id=?`)
        .run(data.cari_id, data.siparis_id, data.tarih, data.cikan_kg, data.birim_fiyat,
          tutar, data.irsaliye_no, data.not_, data.id, data.firma_id);
    } else {
      db.prepare(`INSERT INTO fisler (fis_no, firma_id, cari_id, siparis_id, tarih, cikan_kg,
        birim_fiyat, tutar, irsaliye_no, not_) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(`F-${Date.now()}`, data.firma_id, data.cari_id, data.siparis_id || null, data.tarih,
          data.cikan_kg, data.birim_fiyat, tutar, data.irsaliye_no, data.not_);
    }
    return { success: true };
  },

  deleteFis: (data) => {
    getDatabase().prepare('DELETE FROM fisler WHERE id = ?').run(data.id || data);
    return { success: true };
  },

  faturayaDonustur: (data) => {
    const { fis_ids, firma_id, cari_id, kdv_orani, vade_tarihi } = data;
    const db = getDatabase();
    const fisler = db.prepare(`SELECT * FROM fisler WHERE id IN (${fis_ids.map(() => '?').join(',')})`).all(...fis_ids);
    const ara_toplam = fisler.reduce((s, f) => s + (f.tutar || 0), 0);
    const kdv = ara_toplam * (kdv_orani / 100);
    const genel_toplam = ara_toplam + kdv;
    const toplam_kg = fisler.reduce((s, f) => s + (f.cikan_kg || 0), 0);
    const fatura_no = `FAT-${Date.now()}`;
    const fatura_tarihi = new Date().toISOString().split('T')[0];
    const fatura = db.prepare(`INSERT INTO faturalar (fatura_no, firma_id, cari_id, fatura_tarihi,
      toplam_kg, ara_toplam, kdv_orani, kdv_tutari, genel_toplam, vade_tarihi) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(fatura_no, firma_id, cari_id, fatura_tarihi, toplam_kg, ara_toplam, kdv_orani, kdv, genel_toplam, vade_tarihi);
    const fatura_id = Number(fatura.lastInsertRowid);
    db.prepare(`UPDATE fisler SET faturaya_donustu=1, fatura_id=? WHERE id IN (${fis_ids.map(() => '?').join(',')})`).run(fatura_id, ...fis_ids);
    db.prepare(`INSERT INTO cari_hareketler (firma_id, cari_id, tarih, islem_tipi, belge_no, aciklama, borc, vade_tarihi, referans_id, referans_tip)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(firma_id, cari_id, fatura_tarihi, 'fatura', fatura_no, `${fis_ids.length} fiş - ${toplam_kg} kg`, genel_toplam, vade_tarihi, fatura_id, 'fatura');
    return { success: true, fatura_id };
  }
};

// ─── FATURALAR ────────────────────────────────────────────────────────────────
export const faturaHandlers = {
  getFaturalar: (data) => {
    const { firma_id, cari_id, baslangic, bitis } = data || {};
    let q = `SELECT f.*, c.firma_adi as cari_adi FROM faturalar f
             JOIN cariler c ON f.cari_id = c.id WHERE f.firma_id = ?`;
    const params = [firma_id];
    if (cari_id) { q += ' AND f.cari_id = ?'; params.push(cari_id); }
    if (baslangic) { q += ' AND f.fatura_tarihi >= ?'; params.push(baslangic); }
    if (bitis) { q += ' AND f.fatura_tarihi <= ?'; params.push(bitis); }
    return fixAll(getDatabase().prepare(q + ' ORDER BY f.fatura_tarihi DESC').all(...params));
  },

  tahsilEt: (data) => {
    const { fatura_id, firma_id, cari_id, tutar, odeme_sekli, tarih, not_ } = data;
    const db = getDatabase();
    const fatura = fix(db.prepare('SELECT * FROM faturalar WHERE id = ?').get(fatura_id));
    if (!fatura) return { success: false };
    const yeni_tahsil = (fatura.tahsil_edilen || 0) + tutar;
    const durum = (fatura.genel_toplam - yeni_tahsil) <= 0 ? 'odendi' : 'kismi_odendi';
    db.prepare('UPDATE faturalar SET tahsil_edilen=?, odeme_durumu=? WHERE id=?').run(yeni_tahsil, durum, fatura_id);
    db.prepare(`INSERT INTO cari_hareketler (firma_id, cari_id, tarih, islem_tipi, belge_no, aciklama, alacak, odeme_sekli, referans_id, referans_tip, not_)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(firma_id, cari_id, tarih, 'tahsilat', fatura.fatura_no, `Fatura tahsilat: ${fatura.fatura_no}`, tutar, odeme_sekli, fatura_id, 'fatura', not_);
    return { success: true };
  }
};

// ─── ÇEKLER ───────────────────────────────────────────────────────────────────
export const cekHandlers = {
  getCekler: (data) => {
    const { firma_id, cari_id, durum, baslangic, bitis } = data || {};
    let q = `SELECT ck.*, c.firma_adi as cari_adi FROM cekler ck
             JOIN cariler c ON ck.cari_id = c.id WHERE ck.firma_id = ?`;
    const params = [firma_id];
    if (cari_id) { q += ' AND ck.cari_id = ?'; params.push(cari_id); }
    if (durum) { q += ' AND ck.durum = ?'; params.push(durum); }
    if (baslangic) { q += ' AND ck.vade_tarihi >= ?'; params.push(baslangic); }
    if (bitis) { q += ' AND ck.vade_tarihi <= ?'; params.push(bitis); }
    return fixAll(getDatabase().prepare(q + ' ORDER BY ck.vade_tarihi ASC').all(...params));
  },

  saveCek: (data) => {
    const db = getDatabase();
    if (data.id) {
      db.prepare(`UPDATE cekler SET cari_id=?, alinma_tarihi=?, vade_tarihi=?, tutar=?,
        banka=?, sube=?, kesideci=?, durum=?, not_=? WHERE id=? AND firma_id=?`)
        .run(data.cari_id, data.alinma_tarihi, data.vade_tarihi, data.tutar,
          data.banka, data.sube, data.kesideci, data.durum, data.not_, data.id, data.firma_id);
    } else {
      db.prepare(`INSERT INTO cekler (cek_no, firma_id, cari_id, alinma_tarihi, vade_tarihi,
        tutar, banka, sube, kesideci, durum, not_) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(data.cek_no, data.firma_id, data.cari_id, data.alinma_tarihi, data.vade_tarihi,
          data.tutar, data.banka, data.sube, data.kesideci, data.durum || 'portfolyode', data.not_);
      if (data.cariye_isle) {
        db.prepare(`INSERT INTO cari_hareketler (firma_id, cari_id, tarih, islem_tipi, belge_no, aciklama, alacak, vade_tarihi, odeme_sekli)
          VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(data.firma_id, data.cari_id, data.alinma_tarihi, 'cek', data.cek_no,
            `Çek: ${data.cek_no} - ${data.banka}`, data.tutar, data.vade_tarihi, 'cek');
      }
    }
    return { success: true };
  },

  updateDurum: (data) => {
    getDatabase().prepare('UPDATE cekler SET durum=? WHERE id=?').run(data.durum, data.id);
    return { success: true };
  }
};

// ─── PUANTAJ ──────────────────────────────────────────────────────────────────
export const puantajHandlers = {
  getIsciler: (data) => fixAll(getDatabase().prepare(
    'SELECT * FROM isciler WHERE firma_id = ? AND aktif = 1 ORDER BY ad, soyad'
  ).all(data.firma_id)),

  saveIsci: (data) => {
    const db = getDatabase();
    if (data.id) {
      db.prepare(`UPDATE isciler SET ad=?, soyad=?, giris_tarihi=?, baz_maas=?, yol_ucreti=?, yemek_ucreti=?, izin_hakki=?, not_=? WHERE id=?`)
        .run(data.ad, data.soyad, data.giris_tarihi, data.baz_maas||0, data.yol_ucreti||0, data.yemek_ucreti||0, data.izin_hakki||12, data.not_, data.id);
    } else {
      db.prepare(`INSERT INTO isciler (firma_id, ad, soyad, giris_tarihi, baz_maas, yol_ucreti, yemek_ucreti, izin_hakki, not_) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(data.firma_id, data.ad, data.soyad, data.giris_tarihi, data.baz_maas||0, data.yol_ucreti||0, data.yemek_ucreti||0, data.izin_hakki||12, data.not_);
    }
    return { success: true };
  },

  deleteIsci: (data) => {
    getDatabase().prepare('UPDATE isciler SET aktif = 0 WHERE id = ?').run(data.id || data);
    return { success: true };
  },

  getPuantaj: (data) => {
    const { firma_id, yil, ay } = data;
    const db = getDatabase();
    const isciler = fixAll(db.prepare('SELECT * FROM isciler WHERE firma_id = ? AND aktif = 1 ORDER BY ad, soyad').all(firma_id));
    const puantajlar = fixAll(db.prepare('SELECT * FROM puantaj WHERE firma_id = ? AND yil = ? AND ay = ?').all(firma_id, yil, ay));
    const ayPad = String(ay).padStart(2, '0');
    const avanslar = fixAll(db.prepare(`SELECT isci_id, SUM(tutar) as toplam FROM avanslar WHERE firma_id = ? AND strftime('%Y', tarih) = ? AND strftime('%m', tarih) = ? GROUP BY isci_id`).all(firma_id, String(yil), ayPad));
    return isciler.map(isci => {
      const p = puantajlar.find(x => x.isci_id === isci.id) || {};
      const a = avanslar.find(x => x.isci_id === isci.id) || {};
      return { ...isci, ...p, isci_id: isci.id, puantaj_id: p.id, devam_json: p.devam_json || '{}', avans_toplam: a.toplam || 0 };
    });
  },

  savePuantaj: (data) => {
    const { isci_id, firma_id, yil, ay, devam_json, mesai_saat, mesai_ucret, banka_odeme, nakit_odeme, notlar } = data;
    getDatabase().prepare(`
      INSERT INTO puantaj (isci_id, firma_id, yil, ay, devam_json, mesai_saat, mesai_ucret, banka_odeme, nakit_odeme, notlar)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(isci_id, yil, ay) DO UPDATE SET
      devam_json=excluded.devam_json, mesai_saat=excluded.mesai_saat,
      mesai_ucret=excluded.mesai_ucret, banka_odeme=excluded.banka_odeme,
      nakit_odeme=excluded.nakit_odeme, notlar=excluded.notlar
    `).run(isci_id, firma_id, yil, ay, devam_json||'{}', mesai_saat||0, mesai_ucret||0, banka_odeme||0, nakit_odeme||0, notlar||'');
    return { success: true };
  },

  getAvanslar: (data) => {
    const { firma_id, isci_id, yil, ay } = data || {};
    let q = `SELECT a.*, i.ad, i.soyad FROM avanslar a JOIN isciler i ON a.isci_id = i.id WHERE a.firma_id = ?`;
    const params = [firma_id];
    if (isci_id) { q += ' AND a.isci_id = ?'; params.push(isci_id); }
    if (yil) { q += ` AND strftime('%Y', a.tarih) = ?`; params.push(String(yil)); }
    if (ay) { q += ` AND strftime('%m', a.tarih) = ?`; params.push(String(ay).padStart(2, '0')); }
    return fixAll(getDatabase().prepare(q + ' ORDER BY a.tarih DESC').all(...params));
  },

  saveAvans: (data) => {
    const db = getDatabase();
    if (data.id) {
      db.prepare('UPDATE avanslar SET tarih=?, tutar=?, aciklama=?, not_=? WHERE id=?')
        .run(data.tarih, data.tutar, data.aciklama, data.not_, data.id);
    } else {
      db.prepare('INSERT INTO avanslar (isci_id, firma_id, tarih, tutar, aciklama, not_) VALUES (?,?,?,?,?,?)')
        .run(data.isci_id, data.firma_id, data.tarih, data.tutar, data.aciklama, data.not_);
    }
    return { success: true };
  },

  deleteAvans: (data) => {
    getDatabase().prepare('DELETE FROM avanslar WHERE id = ?').run(data.id || data);
    return { success: true };
  }
};

// ─── EKSTRE & DASHBOARD ───────────────────────────────────────────────────────
export const ekstreHandlers = {
  getEkstre: (data) => {
    const { firma_id, cari_id, baslangic, bitis } = data;
    let q = `SELECT ch.*, fat.toplam_kg, fat.ara_toplam as fatura_ara_toplam
             FROM cari_hareketler ch
             LEFT JOIN faturalar fat ON ch.referans_tip = 'fatura' AND ch.referans_id = fat.id
             WHERE ch.firma_id = ? AND ch.cari_id = ?`;
    const params = [firma_id, cari_id];
    if (baslangic) { q += ' AND ch.tarih >= ?'; params.push(baslangic); }
    if (bitis) { q += ' AND ch.tarih <= ?'; params.push(bitis); }
    const rows = getDatabase().prepare(q + ' ORDER BY ch.tarih ASC, ch.id ASC').all(...params);
    let bakiye = 0;
    return rows.map(r => { bakiye += (r.borc||0) - (r.alacak||0); return { ...fix(r), bakiye }; });
  },

  saveHareket: (data) => {
    const db = getDatabase();
    const { id, firma_id, cari_id, tarih, islem_tipi, belge_no, aciklama, borc, alacak, kg, not_ } = data;
    if (id) {
      db.prepare(`UPDATE cari_hareketler SET tarih=?, islem_tipi=?, belge_no=?, aciklama=?, borc=?, alacak=?, kg=?, not_=? WHERE id=?`)
        .run(tarih, islem_tipi, belge_no||null, aciklama||null, borc||0, alacak||0, kg||0, not_||null, id);
    } else {
      db.prepare(`INSERT INTO cari_hareketler (firma_id, cari_id, tarih, islem_tipi, belge_no, aciklama, borc, alacak, kg, not_) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(firma_id, cari_id, tarih, islem_tipi, belge_no||null, aciklama||null, borc||0, alacak||0, kg||0, not_||null);
    }
    return { success: true };
  },

  deleteHareket: (data) => {
    getDatabase().prepare('DELETE FROM cari_hareketler WHERE id = ?').run(data.id || data);
    return { success: true };
  },

  getDashboard: (data) => {
    const { firma_id } = data;
    const db = getDatabase();
    const bugun = new Date().toISOString().split('T')[0];
    const ay_basi = bugun.substring(0, 7) + '-01';
    const g = (stmt, ...p) => { const r = fix(stmt.get(...p)); return r?.val || 0; };
    return {
      toplam_alacak: g(db.prepare(`SELECT COALESCE(SUM(borc)-SUM(alacak),0) as val FROM cari_hareketler WHERE firma_id=?`), firma_id),
      vadesi_gecen: g(db.prepare(`SELECT COALESCE(SUM(genel_toplam-COALESCE(tahsil_edilen,0)),0) as val FROM faturalar WHERE firma_id=? AND odeme_durumu != 'odendi' AND vade_tarihi < ?`), firma_id, bugun),
      bu_ay_fatura: g(db.prepare(`SELECT COALESCE(SUM(genel_toplam),0) as val FROM faturalar WHERE firma_id=? AND fatura_tarihi >= ?`), firma_id, ay_basi),
      bu_ay_tahsilat: g(db.prepare(`SELECT COALESCE(SUM(alacak),0) as val FROM cari_hareketler WHERE firma_id=? AND islem_tipi='tahsilat' AND tarih >= ?`), firma_id, ay_basi),
      aktif_siparis: g(db.prepare(`SELECT COUNT(*) as val FROM siparisler WHERE firma_id=? AND is_durumu NOT IN ('teslim_edildi','faturalandı','iptal')`), firma_id),
      geciken_siparis: g(db.prepare(`SELECT COUNT(*) as val FROM siparisler WHERE firma_id=? AND is_durumu NOT IN ('teslim_edildi','faturalandı','iptal') AND istenen_termin IS NOT NULL AND istenen_termin != '' AND istenen_termin < ?`), firma_id, bugun),
      faturasiz_fis: g(db.prepare(`SELECT COUNT(*) as val FROM fisler WHERE firma_id=? AND faturaya_donustu=0`), firma_id),
      portfolyo_cek: g(db.prepare(`SELECT COALESCE(SUM(tutar),0) as val FROM cekler WHERE firma_id=? AND durum='portfolyode'`), firma_id),
      yaklasan_cek: g(db.prepare(`SELECT COALESCE(SUM(tutar),0) as val FROM cekler WHERE firma_id=? AND durum='portfolyode' AND vade_tarihi BETWEEN ? AND date(?, '+7 days')`), firma_id, bugun, bugun),
      cari_bakiyeler: fixAll(db.prepare(`
        SELECT c.firma_adi, c.id,
          COALESCE(SUM(ch.borc),0) as borc, COALESCE(SUM(ch.alacak),0) as alacak,
          COALESCE(SUM(ch.borc),0)-COALESCE(SUM(ch.alacak),0) as bakiye
        FROM cariler c
        LEFT JOIN cari_hareketler ch ON c.id=ch.cari_id AND ch.firma_id=?
        WHERE c.aktif=1 AND (ch.borc > 0 OR ch.alacak > 0)
        GROUP BY c.id ORDER BY bakiye DESC LIMIT 10
      `).all(firma_id)),
    };
  },

  getDashboardAksiyonlar: (data) => {
    const { firma_id } = data;
    const db = getDatabase();
    const bugun = new Date().toISOString().split('T')[0];
    return {
      vadesi_gecen_faturalar: fixAll(db.prepare(`
        SELECT f.id, f.fatura_no, f.fatura_tarihi, f.vade_tarihi, f.cari_id,
          f.genel_toplam, f.tahsil_edilen,
          ROUND(f.genel_toplam - COALESCE(f.tahsil_edilen,0), 2) as kalan_tutar,
          CAST(julianday(?) - julianday(f.vade_tarihi) AS INTEGER) as gecen_gun,
          c.firma_adi as cari_adi
        FROM faturalar f JOIN cariler c ON f.cari_id = c.id
        WHERE f.firma_id=? AND f.odeme_durumu != 'odendi' AND f.vade_tarihi < ?
        ORDER BY f.vade_tarihi ASC LIMIT 20
      `).all(bugun, firma_id, bugun)),
      yaklasan_cekler: fixAll(db.prepare(`
        SELECT ck.id, ck.cek_no, ck.vade_tarihi, ck.tutar, ck.banka, ck.durum, ck.cari_id,
          c.firma_adi as cari_adi
        FROM cekler ck JOIN cariler c ON ck.cari_id = c.id
        WHERE ck.firma_id=? AND ck.durum='portfolyode' AND ck.vade_tarihi BETWEEN ? AND date(?, '+30 days')
        ORDER BY ck.vade_tarihi ASC LIMIT 15
      `).all(firma_id, bugun, bugun))
    };
  },

  getAylikCiro: (data) => {
    const { firma_id, yil } = data;
    return fixAll(getDatabase().prepare(`
      SELECT strftime('%m', f.fatura_tarihi) as ay, c.id as cari_id, c.firma_adi,
        COUNT(*) as fatura_sayisi,
        COALESCE(SUM(f.toplam_kg), 0) as toplam_kg,
        COALESCE(SUM(f.ara_toplam), 0) as ara_toplam,
        COALESCE(SUM(f.genel_toplam), 0) as genel_toplam
      FROM faturalar f JOIN cariler c ON f.cari_id = c.id
      WHERE f.firma_id = ? AND strftime('%Y', f.fatura_tarihi) = ?
      GROUP BY strftime('%m', f.fatura_tarihi), f.cari_id
      ORDER BY ay ASC, genel_toplam DESC
    `).all(firma_id, String(yil)));
  }
};

// ─── ARAMA ────────────────────────────────────────────────────────────────────
export const aramaHandlers = {
  globalArama: (data) => {
    const { firma_id, q } = data;
    if (!q || q.length < 2) return { cariler: [], siparisler: [], faturalar: [] };
    const like = `%${q}%`;
    const db = getDatabase();
    return {
      cariler: fixAll(db.prepare(`SELECT id, firma_adi, cari_kodu, telefon FROM cariler WHERE aktif=1 AND (firma_adi LIKE ? OR cari_kodu LIKE ? OR telefon LIKE ?) LIMIT 5`).all(like, like, like)),
      siparisler: fixAll(db.prepare(`SELECT s.id, s.siparis_no, s.is_durumu, c.firma_adi as cari_adi FROM siparisler s JOIN cariler c ON s.cari_id=c.id WHERE s.firma_id=? AND (s.siparis_no LIKE ? OR c.firma_adi LIKE ? OR s.iplik_cinsi LIKE ?) LIMIT 5`).all(firma_id, like, like, like)),
      faturalar: fixAll(db.prepare(`SELECT f.id, f.fatura_no, f.fatura_tarihi, f.genel_toplam, c.firma_adi as cari_adi FROM faturalar f JOIN cariler c ON f.cari_id=c.id WHERE f.firma_id=? AND (f.fatura_no LIKE ? OR c.firma_adi LIKE ?) LIMIT 5`).all(firma_id, like, like)),
    };
  }
};
