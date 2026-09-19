# EMS IPAM Core v0.7.1

هسته مستقل پروژه EMS IPAM برای مدیریت آدرس‌های IP و آماده برای اضافه‌شدن ماژول‌ها به شکل Drop-in.

Repository رسمی پروژه:

```text
https://github.com/emsebi/EMS_IPAM
```

## این نسخه چه چیزی دارد؟

- PostgreSQL مشترک و پایدار
- Login و نقش‌های Admin / Editor / Viewer
- شرکت، شعبه و دسترسی کاربران به شرکت یا Address Space
- Address Space از `/16` تا `/24`
- Prefix/Subnetهای فرزند تا `/32`
- نمای تصویری، جدول عمودی و Tree تا IP نهایی
- ثبت Hostname، MAC، VLAN، Owner، Location، Notes و وضعیت IP
- جستجوی سراسری اطلاعات IPAM
- Ping دستی
- Import/Export یک Subnet
- Backup دیتابیس قبل از Update
- Audit Log و Trash/Restore
- Dark/Light theme
- زیرساخت ماژول‌های مستقل بدون وابستگی Core به ماژول‌ها

## معماری ماژولار

هسته فقط سرویس‌های `db` و `app` را اجرا می‌کند. ماژول‌های جدید فقط زمانی شناسایی می‌شوند که پوشه آن‌ها دارای `module.env` معتبر باشد. پوشه‌های قدیمی یا ناقص در `modules/` باعث Fail شدن نصب Core نمی‌شوند.

ماژول‌های برنامه‌ریزی‌شده:

- `network-map`
- `device-access`
- `mac-finder`
- `radius-mab`

جزئیات قرارداد توسعه در `docs/MODULE-SDK-FA.md` آمده است.

# نصب

## روش پیشنهادی: یک دستور برای همه مراحل

Installer ابتدا پیش‌نیازها را بررسی می‌کند. اگر Docker، Docker Compose یا Portainer وجود نداشته باشد، آن‌ها را نصب می‌کند و سپس منوی EMS IPAM را نمایش می‌دهد.

```bash
curl -fsSL https://raw.githubusercontent.com/emsebi/EMS_IPAM/main/install.sh | sudo bash
```

منوی Installer:

```text
1) Install
2) Update
3) Uninstall application (keep database)
4) Uninstall application + database
```

## اجرای Installer از Clone یا فایل‌های Extract شده

اگر Repository را Clone کرده‌اید یا فایل ZIP را Extract کرده‌اید، از داخل ریشه پروژه فقط این دستور را اجرا کنید:

```bash
sudo bash install.sh
```

Installer در این حالت فایل‌های همان پوشه را استفاده می‌کند.

# پیش‌نیازها

پیش‌نیازهای اصلی:

- Ubuntu / Debian
- Docker Engine
- Docker Compose Plugin
- Portainer CE

در نصب معمولی نیازی نیست پیش‌نیازها را جدا نصب کنید؛ `install.sh` این کار را خودکار انجام می‌دهد.

اگر فقط قصد نصب یا تعمیر پیش‌نیازها را دارید:

```bash
curl -fsSL https://raw.githubusercontent.com/emsebi/EMS_IPAM/main/scripts/install-prerequisites.sh | sudo bash
```

این اسکریپت Docker Engine، Docker Compose و Portainer CE را بررسی و در صورت نیاز نصب می‌کند.

# رفتار Update

گزینه Update قبل از جایگزینی فایل‌های برنامه از PostgreSQL Backup می‌گیرد، فایل `.env` و دیتابیس Docker را حفظ می‌کند، نسخه جدید را نصب و Health Check می‌کند. اگر نسخه جدید Healthy نشود، فایل‌های نسخه قبلی Restore می‌شوند.

# حذف برنامه بدون دیتابیس

گزینه 3 برنامه و Containerهای EMS IPAM را حذف می‌کند اما Docker Volume دیتابیس را نگه می‌دارد. اطلاعات Recovery در مسیر زیر نگهداری می‌شوند:

```text
/var/lib/ems-ipam
```

بنابراین نصب بعدی می‌تواند Credential دیتابیس قبلی را مجدداً استفاده کند.

# حذف کامل

گزینه 4 پس از درخواست عبارت تأیید `DELETE`، برنامه، Docker Volume دیتابیس و اطلاعات Recovery را حذف می‌کند.

# ساختار اصلی

```text
compose.yml
docker-app/
  server/
  public/
  tests/
modules/
  _template/
scripts/
  build-module-registry.py
  install-prerequisites.sh
docs/
  MODULE-SDK-FA.md
install.sh
```

# تست

```bash
cd docker-app
npm test
```
