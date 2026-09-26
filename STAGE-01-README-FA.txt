EMS_IPAM - BASE + IPAM + Radio
Version: 1.6.1

این ZIP برای Merge مستقیم با ریشه Repository زیر ساخته شده است:
https://github.com/emsebi/EMS_IPAM

محتویات ZIP را Extract و در ریشه Repository قرار دهید.
install.sh و compose.yml باید مستقیماً در ریشه GitHub دیده شوند.

این نسخه شامل Core، PostgreSQL، Installer، Company/Site/Branch، Personnel، Inventory، Settings، Audit، Backup، IPAM و افزونه Radio است.
ماژول‌های RADIUS، ورود کاربران به تجهیزات، Network Map، MAC Finder و Network Access در این ZIP پیاده‌سازی نشده‌اند.

نصب/آپدیت:
curl -fsSL https://raw.githubusercontent.com/emsebi/EMS_IPAM/main/install.sh | sudo bash
