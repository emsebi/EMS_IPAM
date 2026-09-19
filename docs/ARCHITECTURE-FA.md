# معماری EMS_IPAM

## هسته ثابت

Core مالک داده‌های مشترک است:

- Authentication و Session
- Panel Users و Roles
- Company / Site
- Personnel
- Device Inventory
- Settings
- Audit
- Backup Metadata
- Module Registry

ماژول‌ها برای این اطلاعات جدول موازی ایجاد نمی‌کنند و از شناسه‌های Core استفاده می‌کنند.

## ماژول‌ها

هر ماژول یک پوشه مستقل دارد:

```text
modules/<module-id>/
├── module.json
├── backend/
├── frontend/
├── migrations/
└── README-FA.md
```

Core هنگام Start فقط پوشه‌هایی را Load می‌کند که `module.json` معتبر داشته باشند. نبودن یا خراب بودن یک پوشه قدیمی نباید Core را متوقف کند.

## ماژول‌های برنامه‌ریزی‌شده

```text
modules/ipam/
modules/radio/
modules/radius/
modules/network-map/
modules/mac-finder/
modules/network-access/
```

این فهرست محدودکننده نیست و ماژول جدید در آینده با همان قرارداد قابل اضافه شدن است.

## Database Ownership

Core Schema اطلاعات پایه را نگهداری می‌کند. هر Module Migrationهای مخصوص خودش را دارد و Foreign Key به موجودیت‌های Core می‌دهد. این طراحی باعث می‌شود تغییر یک ماژول نیاز به بازنویسی کل پروژه نداشته باشد.

## Frontend Integration

Core مسیر زیر را برای رابط هر Module رزرو کرده است:

```text
/m/<module-id>/
```

Module Loader Navigation را از `module.json` می‌خواند و ورودی ماژول را به Sidebar اضافه می‌کند. صفحه ماژول داخل Workspace اصلی EMS نمایش داده می‌شود.

## Backend Integration

Backend ماژول می‌تواند تابع `register()` صادر کند و API Routeهای خودش را Register کند. Failure یک Module Log می‌شود و Core به کار خود ادامه می‌دهد.
