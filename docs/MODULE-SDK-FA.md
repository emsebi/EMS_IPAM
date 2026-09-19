# EMS_IPAM Module SDK

هدف این قرارداد آن است که هر قابلیت جدید بدون بازسازی هسته به پروژه اضافه شود.

## حداقل ساختار

```text
modules/example/
├── module.json
├── backend/
│   └── index.mjs
├── frontend/
│   └── index.html
└── README-FA.md
```

نمونه `module.json`:

```json
{
  "id": "example",
  "name": "Example",
  "version": "1.0.0",
  "description": "Example module",
  "enabledByDefault": true,
  "navigation": {
    "label": "Example",
    "icon": "◇"
  },
  "backend": "backend/index.mjs",
  "frontend": "frontend/index.html",
  "dependencies": ["core>=1.0.0"]
}
```

## Backend

```js
export async function register({ route, query, id, manifest }) {
  route('GET', '/api/example/status', async ({ res, json }) => {
    json(res, 200, { ok: true, module: manifest.id });
  }, 'viewer');
}
```

توابع مشترک Core به Module تزریق می‌شوند تا Module برای Authentication و Database یک پیاده‌سازی جدا نسازد.

## Frontend

صفحه `frontend/index.html` به صورت خودکار در مسیر زیر قابل دسترسی است:

```text
/m/example/
```

وقتی `navigation` در Manifest تعریف شده باشد، Core ورودی آن را در Sidebar نمایش می‌دهد.

## اصل Isolation

- ماژول نباید فایل‌های Core را Patch کند.
- ماژول نباید User Table جدا بسازد.
- ماژول نباید Company/Site/Device تکراری بسازد.
- خطای ماژول نباید Core را متوقف کند.
- Migration ماژول باید Idempotent باشد.
