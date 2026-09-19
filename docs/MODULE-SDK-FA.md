# معماری ماژول‌های EMS IPAM

هسته نسخه 0.7 شامل دیتابیس، احراز هویت، شرکت‌ها، فضای آدرس، Prefix/Subnet و مدیریت IP است. قابلیت‌های بزرگ بعدی به صورت ماژول مستقل ساخته می‌شوند.

## ماژول‌های برنامه‌ریزی‌شده

1. `network-map` — Discovery، Topology، Backup Config و نمایش مسیرها.
2. `device-access` — مدیریت دسترسی و اتصال به تجهیزات، SSH/HTTPS/Winbox/RDP و سطح دسترسی.
3. `mac-finder` — جستجوی MAC/IP و پیدا کردن Switch/Port و مسیر تا Access.
4. `radius-mab` — FreeRADIUS، کاربران Cisco/MikroTik، MAC-to-VLAN، MAB و همگام‌سازی با شبکه.

## قرارداد Drop-in

هر ماژول در مسیر `modules/<id>/` قرار می‌گیرد و حداقل `module.env` و `compose.module.yml` دارد. اسکریپت نصب پوشه را خودکار کشف می‌کند؛ بنابراین برای اضافه‌کردن یک ماژول جدید لازم نیست `compose.yml` هسته ویرایش شود.

فیلدهای اصلی `module.env`:

- `EMS_MODULE_ID`
- `EMS_MODULE_NAME`
- `EMS_MODULE_DESCRIPTION`
- `EMS_MODULE_ICON`
- `EMS_MODULE_DEFAULT`
- `EMS_MODULE_ENV_FLAG`
- `EMS_MODULE_UPSTREAM`
- `EMS_MODULE_COMPOSE`

هسته پس از Login، مسیر `/m/<module-id>/` را به سرویس داخلی ماژول Proxy می‌کند و هویت کاربر را فقط از شبکه داخلی در Headerهای `X-EMS-*` تحویل می‌دهد. سرویس ماژول نباید پورت عمومی Publish کند.

هر ماژول باید Migration/Schema خودش را مدیریت کند و جدول‌های اختصاصی خود را با Prefix مشخص ایجاد کند تا هسته مستقل بماند.
