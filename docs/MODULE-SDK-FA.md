# EMS IPAM Module SDK

هسته Base مستقل است. قابلیت‌های آینده در `modules/<module-id>/` اضافه می‌شوند.

## ساختار حداقل
```text
modules/example-module/
├── module.json
├── backend/
├── frontend/
├── migrations/
└── README.md
```

اگر ماژول سرویس Docker مستقل لازم دارد، `compose.module.yml` هم اضافه می‌شود.

## نمونه module.json
```json
{
  "id": "example-module",
  "name": "Example Module",
  "version": "0.1.0",
  "route": "/example-module",
  "icon": "puzzle",
  "dependencies": ["core", "ipam"],
  "permissions": ["admin", "support"],
  "enabled": true
}
```

## اصول
- PostgreSQL اصلی مشترک است؛ داده مشترک Duplicate نشود.
- Migration ماژول Idempotent باشد.
- خرابی/حذف یک ماژول Core و IPAM را Down نکند.
- IP، Device، Company، Site و Personnel با ID به Base متصل شوند.
- ماژول به Search و Permission Matrix هسته متصل شود.
- Secret داخل Git یا Log ذخیره نشود.
- هر آبجکت قابل ایجاد مسیر Edit/Delete مناسب داشته باشد.

## ماژول‌های برنامه‌ریزی‌شده
- radio
- radius
- network-map
- mac-finder
- network-access
