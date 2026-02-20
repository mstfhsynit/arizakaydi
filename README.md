# Okul Ariza & Tadilat Demo Sistemi

Node.js + Express + SQLite + JWT + Vanilla JS ile rol bazli demo sistem.
Arayuz modern SaaS dashboard yaklasimina gore premium UI ile guncellenmistir.

## Kurulum

```bash
npm install
npm start
```

Sunucu: `http://localhost:3000`

## Demo Hesaplar

- `admin / admin123`
- `manager / manager123`
- `teacher / teacher123`

## Sayfalar

- `/login`
- `/dashboard`
- `/create-request` (`user` + `manager`)
- `/my-requests` (sadece `user`)
- `/admin-panel` (`admin` + `manager`)
- `/users` (sadece `admin`)

## Teknik Notlar

- JWT tabanli auth + role middleware
- Sifreler `bcrypt` ile hashlenir
- Her kullanici sifre degistirebilir
- Kullanici olusturma/guncelleme ve sifre degistirmede `sifre tekrar` dogrulamasi vardir
- `Acil` veya `Diger` seciminde aciklama zorunlu
- Admin kayit durumunu guncelleyebilir
- Manager kayit olusturabilir ve tum kayitlari goruntuleyebilir, durum degisikligi yapamaz
- Demo amacli `users.demo_password` kolonu kullanici listesindeki sifre gorunurlugu icindir
- UI metinleri `public/locales/tr.json` uzerinden i18n sistemi ile yonetilir
- Topbar saginda tema toggle ile dark/light mode degisimi desteklenir
