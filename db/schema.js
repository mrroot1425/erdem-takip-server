export function initializeDatabase(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS firmalar (
      id INTEGER PRIMARY KEY,
      ad TEXT NOT NULL,
      aktif INTEGER DEFAULT 1
    );
    INSERT OR IGNORE INTO firmalar (id, ad) VALUES (1, 'Erdem Büküm');
    INSERT OR IGNORE INTO firmalar (id, ad) VALUES (2, 'Erdem Fantazi');

    CREATE TABLE IF NOT EXISTS kullanicilar (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kullanici_adi TEXT UNIQUE NOT NULL,
      sifre_hash TEXT NOT NULL,
      ad_soyad TEXT NOT NULL,
      rol TEXT DEFAULT 'personel',
      aktif INTEGER DEFAULT 1,
      olusturma_tarihi TEXT DEFAULT (datetime('now', 'localtime'))
    );
    INSERT OR IGNORE INTO kullanicilar (kullanici_adi, sifre_hash, ad_soyad, rol)
    VALUES ('admin', 'admin123', 'Yönetici', 'yonetici');

    CREATE TABLE IF NOT EXISTS cariler (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cari_kodu TEXT UNIQUE NOT NULL,
      firma_adi TEXT NOT NULL,
      yetkili TEXT, telefon TEXT, telefon2 TEXT,
      mail TEXT, adres TEXT, vergi_dairesi TEXT, vergi_no TEXT, not_ TEXT,
      aktif INTEGER DEFAULT 1,
      olusturma_tarihi TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS cari_firma_ayarlari (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cari_id INTEGER NOT NULL, firma_id INTEGER NOT NULL,
      calisma_tipi TEXT DEFAULT 'acik_hesap',
      odeme_vadesi INTEGER DEFAULT 30, risk_limiti REAL DEFAULT 0, not_ TEXT,
      FOREIGN KEY (cari_id) REFERENCES cariler(id),
      FOREIGN KEY (firma_id) REFERENCES firmalar(id),
      UNIQUE(cari_id, firma_id)
    );

    CREATE TABLE IF NOT EXISTS siparisler (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      siparis_no TEXT NOT NULL, firma_id INTEGER NOT NULL, cari_id INTEGER NOT NULL,
      tarih TEXT NOT NULL, iplik_cinsi TEXT, iplik_acilimi TEXT,
      gelen_kg REAL, bukum_miktari TEXT, tpm TEXT, bukum_yonu TEXT, kat_sayisi TEXT,
      recete_notu TEXT, istenen_termin TEXT,
      is_durumu TEXT DEFAULT 'beklemede',
      teslim_edilen_kg REAL DEFAULT 0, fire_kg REAL DEFAULT 0, birim_fiyat REAL, not_ TEXT,
      olusturma_tarihi TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (firma_id) REFERENCES firmalar(id),
      FOREIGN KEY (cari_id) REFERENCES cariler(id)
    );

    CREATE TABLE IF NOT EXISTS fisler (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fis_no TEXT NOT NULL, firma_id INTEGER NOT NULL, cari_id INTEGER NOT NULL,
      siparis_id INTEGER, tarih TEXT NOT NULL, cikan_kg REAL, birim_fiyat REAL, tutar REAL,
      irsaliye_no TEXT, faturaya_donustu INTEGER DEFAULT 0, fatura_id INTEGER, not_ TEXT,
      olusturma_tarihi TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (firma_id) REFERENCES firmalar(id),
      FOREIGN KEY (cari_id) REFERENCES cariler(id)
    );

    CREATE TABLE IF NOT EXISTS faturalar (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fatura_no TEXT NOT NULL, firma_id INTEGER NOT NULL, cari_id INTEGER NOT NULL,
      fatura_tarihi TEXT NOT NULL, toplam_kg REAL, ara_toplam REAL,
      kdv_orani REAL DEFAULT 20, kdv_tutari REAL, genel_toplam REAL,
      vade_tarihi TEXT, odeme_durumu TEXT DEFAULT 'odenmedi',
      tahsil_edilen REAL DEFAULT 0, not_ TEXT,
      olusturma_tarihi TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (firma_id) REFERENCES firmalar(id),
      FOREIGN KEY (cari_id) REFERENCES cariler(id)
    );

    CREATE TABLE IF NOT EXISTS cari_hareketler (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firma_id INTEGER NOT NULL, cari_id INTEGER NOT NULL, tarih TEXT NOT NULL,
      islem_tipi TEXT NOT NULL, belge_no TEXT, aciklama TEXT,
      borc REAL DEFAULT 0, alacak REAL DEFAULT 0, kg REAL DEFAULT 0,
      vade_tarihi TEXT, odeme_sekli TEXT, referans_id INTEGER, referans_tip TEXT, not_ TEXT,
      olusturma_tarihi TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (firma_id) REFERENCES firmalar(id),
      FOREIGN KEY (cari_id) REFERENCES cariler(id)
    );

    CREATE TABLE IF NOT EXISTS isciler (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firma_id INTEGER NOT NULL, ad TEXT NOT NULL, soyad TEXT,
      giris_tarihi TEXT, baz_maas REAL DEFAULT 0, yol_ucreti REAL DEFAULT 0,
      yemek_ucreti REAL DEFAULT 0, izin_hakki INTEGER DEFAULT 12,
      aktif INTEGER DEFAULT 1, not_ TEXT,
      olusturma_tarihi TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS puantaj (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      isci_id INTEGER NOT NULL, firma_id INTEGER NOT NULL,
      yil INTEGER NOT NULL, ay INTEGER NOT NULL,
      devam_json TEXT DEFAULT '{}', mesai_saat REAL DEFAULT 0, mesai_ucret REAL DEFAULT 0,
      banka_odeme REAL DEFAULT 0, nakit_odeme REAL DEFAULT 0, notlar TEXT,
      UNIQUE(isci_id, yil, ay)
    );

    CREATE TABLE IF NOT EXISTS avanslar (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      isci_id INTEGER NOT NULL, firma_id INTEGER NOT NULL,
      tarih TEXT NOT NULL, tutar REAL NOT NULL, aciklama TEXT, not_ TEXT,
      olusturma_tarihi TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS cekler (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cek_no TEXT NOT NULL, firma_id INTEGER NOT NULL, cari_id INTEGER NOT NULL,
      alinma_tarihi TEXT NOT NULL, vade_tarihi TEXT NOT NULL, tutar REAL NOT NULL,
      banka TEXT, sube TEXT, kesideci TEXT,
      durum TEXT DEFAULT 'portfolyode',
      cariye_islendi INTEGER DEFAULT 0, not_ TEXT,
      olusturma_tarihi TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (firma_id) REFERENCES firmalar(id),
      FOREIGN KEY (cari_id) REFERENCES cariler(id)
    );

    CREATE INDEX IF NOT EXISTS idx_ch_firma_cari  ON cari_hareketler(firma_id, cari_id);
    CREATE INDEX IF NOT EXISTS idx_ch_firma_tarih ON cari_hareketler(firma_id, tarih);
    CREATE INDEX IF NOT EXISTS idx_sip_firma      ON siparisler(firma_id, tarih);
    CREATE INDEX IF NOT EXISTS idx_fat_firma      ON faturalar(firma_id, fatura_tarihi);
    CREATE INDEX IF NOT EXISTS idx_fis_firma      ON fisler(firma_id, tarih);
    CREATE INDEX IF NOT EXISTS idx_cek_firma      ON cekler(firma_id, vade_tarihi);
    CREATE INDEX IF NOT EXISTS idx_avans_firma    ON avanslar(firma_id, tarih);
  `);

  try { db.exec('ALTER TABLE cari_hareketler ADD COLUMN kg REAL DEFAULT 0'); } catch(e) {}
}
