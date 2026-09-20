# نصب و Update — EMS_IPAM v1.4.0-stage1

## نصب معمولی

فقط یک دستور:

```bash
curl -fsSL https://raw.githubusercontent.com/emsebi/EMS_IPAM/main/install.sh | sudo bash
```

Installer خودش Docker Engine، Docker Compose Plugin و Portainer CE را بررسی می‌کند و در Ubuntu/Debian موارد کمبود را نصب می‌کند.

در Fresh Install موارد زیر پرسیده می‌شود:

```text
Database password
Admin username
Admin password
Web port
```

State و Secretهای نصب در GitHub ذخیره نمی‌شوند:

```text
/var/lib/ems-ipam/.env
```

## منوی Lifecycle

```text
1) Install
2) Update
3) Uninstall application (keep database)
4) Uninstall application + database
```

### 1 — Install

- Download سورس از `emsebi/EMS_IPAM@main`
- بررسی Archive
- ساخت State directory
- ساخت PostgreSQL volume ثابت
- Build App
- Start DB/App
- Health Check
- Start ماژول‌های معتبر

اگر قبلاً گزینه 3 اجرا شده باشد و Database + State هر دو وجود داشته باشند، Install دوباره همان اطلاعات را استفاده می‌کند.

### 2 — Update — حالت حفظ اطلاعات

ترتیب Update عمداً Data-safe است:

1. بررسی معتبر بودن نصب فعلی
2. Start کردن DB در صورت خاموش بودن
3. گرفتن **Backup اجباری** با `pg_dump`
4. بررسی غیرخالی بودن Backup
5. Download نسخه جدید در Temporary directory
6. کپی سورس جدید به Staging
7. جابه‌جایی Atomic-ish پوشه Application
8. Build/Start نسخه جدید روی **همان DB volume و همان .env**
9. Health Check
10. در صورت Fail، بازگرداندن فایل‌های نسخه قبل

در Update از `down -v` استفاده نمی‌شود.

Database volume:

```text
ems_ipam_db_data
```

Backup قبل از Update:

```text
/var/lib/ems-ipam/backups/pre-update-YYYYMMDD-HHMMSS.sql.gz
```

### 3 — حذف App با حفظ اطلاعات

Application حذف می‌شود ولی موارد زیر باقی می‌مانند:

```text
ems_ipam_db_data
/var/lib/ems-ipam/.env
/var/lib/ems-ipam/backups
```

### 4 — حذف کامل

فقط این گزینه Database volume و State را حذف می‌کند و قبل از اجرا Confirmation می‌گیرد.

## نصب فقط پیش‌نیازها

```bash
curl -fsSL https://raw.githubusercontent.com/emsebi/EMS_IPAM/main/scripts/install-prerequisites.sh | sudo bash
```

## عیب‌یابی

وضعیت:

```bash
sudo docker compose --project-name ems-ipam --env-file /var/lib/ems-ipam/.env -f /opt/ems-ipam/compose.yml ps
```

App log:

```bash
sudo docker compose --project-name ems-ipam --env-file /var/lib/ems-ipam/.env -f /opt/ems-ipam/compose.yml logs --tail=200 app
```

DB log:

```bash
sudo docker compose --project-name ems-ipam --env-file /var/lib/ems-ipam/.env -f /opt/ems-ipam/compose.yml logs --tail=200 db
```
