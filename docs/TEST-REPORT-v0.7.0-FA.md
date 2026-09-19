# گزارش آزمون EMS IPAM v0.7.0

## آزمون‌های انجام‌شده

- Syntax Check برای Core Server و Browser JS.
- Syntax Check برای Network Map Server/UI/Device UI.
- Syntax Check برای RADIUS Server/Renderer/UI.
- `bash -n` برای Installer اصلی و Installer ماژول‌ها.
- مجموعه تست Core: 32 تست.
- مجموعه تست Network Map: 7 تست.
- مجموعه تست RADIUS Renderer: 2 تست.
- بررسی تولید Client CIDR، User Attribute، Dynamic VLAN و Explicit Reject برای MAC Block/Disabled.
- بررسی ساخت تصاویر و بسته Windows Client.

## نتیجه

تمام تست‌های Node که در محیط Build قابل اجرا بودند Pass شدند.

## محدودیت محیط Build

Docker Engine در محیط تولید Release حاضر نبود، بنابراین Build کامل Imageها و تست اتصال واقعی به Cisco/MikroTik/FreeRADIUS در همین محیط انجام نشده است. قبل از استفاده Production، تست Pilot روی یک یا چند سوییچ و Router واقعی توصیه می‌شود.
