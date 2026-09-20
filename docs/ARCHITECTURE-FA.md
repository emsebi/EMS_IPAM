# معماری Base و Modules

## اصل اصلی

Core + IPAM همیشه مستقل و قابل استفاده است. افزونه خراب یا حذف‌شده نباید Core را Down کند.

یک PostgreSQL مشترک منبع اطلاعات است. IP، Company، Personnel و Device توسط افزونه‌ها Duplicate نمی‌شوند.

## Base

```text
Core
├── Authentication
├── Users / Roles / Module Permissions
├── Settings
├── Company / Site / Branch
├── Personnel
├── Inventory
├── Search
├── Audit
├── Backup
└── IPAM
```

## افزونه‌های برنامه‌ریزی‌شده

```text
modules/radio
modules/radius
modules/network-map
modules/mac-finder
modules/network-access
```

### Radio

AP/Station به همان Host/IP موجود در IPAM متصل می‌شود. Search باید Name/IP/MAC/SSID را پوشش دهد.

### RADIUS

FreeRADIUS برای Device AAA و System User. Network Access نیز از همین Backend استفاده می‌کند.

### Network Map

Cisco discovery فقط Read-only و Sync با Inventory/IPAM.

### MAC Finder

Current location + history و اتصال به Network Map.

### Network Access

802.1X/MAB، MAC Registry، Static/Dynamic VLAN و Unknown policy با FreeRADIUS.

## Module permissions

جدول `user_module_access` مستقل از Role است. Admin همه دسترسی‌ها را دارد. برای Userهای دیگر Admin می‌تواند Moduleها را جدا انتخاب کند.

Module جدیدی که در آینده به Repository اضافه شود می‌تواند با `module.json` به Loader معرفی شود؛ Core برای اضافه شدن Feature جدید نیاز به بازنویسی ندارد.
