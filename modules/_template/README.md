# EMS_IPAM module template

هر افزونه در پوشه مستقل `modules/<module-id>/` قرار می‌گیرد. حداقل فایل لازم `module.json` است.

برای رابط کاربری مستقل، فایل‌ها را در `public/` قرار دهید. Core آن‌ها را از مسیر `/m/<module-id>/` ارائه می‌کند.

اگر ماژول سرویس Docker مستقل دارد، فایل `compose.module.yml` را کنار `module.json` قرار دهید. Installer آن را خودکار به Docker Compose اضافه می‌کند. در این حالت می‌توان در `module.json` بخش `proxy` تعریف کرد:

```json
{
  "proxy": {
    "upstream": "http://sample-module:8080",
    "stripPrefix": true
  }
}
```

خرابی یا نبود یک ماژول نباید Core + IPAM را متوقف کند.
