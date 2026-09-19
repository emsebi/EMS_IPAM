# EMS IPAM Core v0.7.0

هسته مستقل پروژه EMS IPAM برای مدیریت آدرس‌های IP و آماده برای اضافه‌شدن ماژول‌ها به شکل Drop-in.

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
- Backup/Restore دیتابیس
- Audit Log و Trash/Restore
- Dark/Light theme
- زیرساخت ماژول‌های مستقل بدون ویرایش `compose.yml` هسته

## معماری

هسته فقط سرویس‌های `db` و `app` را اجرا می‌کند. قابلیت‌های بزرگ بعدی در `modules/<module-id>/` قرار می‌گیرند. نصب‌کننده `module.env` و `compose.module.yml` را به‌صورت خودکار کشف می‌کند و ماژول فعال از مسیر `/m/<module-id>/` داخل همان پنل در دسترس قرار می‌گیرد.

ماژول‌های برنامه‌ریزی‌شده:

- `network-map`
- `device-access`
- `mac-finder`
- `radius-mab`

جزئیات قرارداد توسعه در `docs/MODULE-SDK-FA.md` آمده است.

## نصب روی Ubuntu

```bash
sudo bash install.sh
```

برای نصب مستقیم از پوشه‌ای که روی سرور کپی شده:

```bash
sudo EMS_INSTALL_SOURCE_DIR="$PWD" bash install.sh install
```

پس از اضافه‌شدن ماژول جدید به Repository، گزینه `Update` فایل‌ها را دریافت می‌کند و گزینه `Enable/Disable Modules` امکان فعال‌سازی آن را می‌دهد.

## ساختار اصلی

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
docs/
  MODULE-SDK-FA.md
install.sh
```

## تست

```bash
cd docker-app
npm test
```

در زمان ساخت این خروجی، تمام تست‌های Core با موفقیت اجرا شده‌اند.
