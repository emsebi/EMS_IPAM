# Network Map در EMS IPAM v0.7.0

ماژول Network Map یک سرویس اختیاری است که از Session و PostgreSQL هسته EMS استفاده می‌کند.

## روند کار

۱. یک Map برای شرکت/سایت ساخته می‌شود.  
۲. IP یک Seed Switch وارد می‌شود.  
۳. اتصال با Credential دستی یا `SYSTEM ACCOUNT` انجام می‌شود.  
۴. اطلاعات CDP/LLDP، Port، VLAN، MAC Table، Version و Inventory خوانده می‌شود.  
۵. همسایه‌های دارای Management IP به‌صورت مرحله‌ای کشف می‌شوند.  
۶. نتیجه به‌صورت Snapshot تاریخی ذخیره می‌شود.

Discovery برای Configuration Change طراحی نشده و فرمان‌های آن Read-Only هستند.

## قابلیت‌های عملیاتی

- Zoom / Pan / Fit Map
- وضعیت پایه Online/Offline به درخواست کاربر
- جست‌وجوی نام/IP سوییچ
- جست‌وجوی VLAN و Highlight همه سوییچ‌های دارای VLAN
- جست‌وجوی MAC و ترجیح Leaf/Access Port نسبت به Uplink
- نمایش Portهای دو طرف Link
- افزودن دستی سوییچ کشف‌نشده
- لینک رکورد Switch به IPAM
- Refresh یک سوییچ
- Backup امن و Compare نسخه‌ها
- اتصال با Windows Client

## MAC Baseline

Admin می‌تواند از آخرین Snapshot، MACهای endpoint را به Network Access وارد کند. MACهایی که فقط روی پورت Uplink دیده شده‌اند Import نمی‌شوند. رکوردهای موجود دست‌نخورده باقی می‌مانند.

## System Account

اگر FreeRADIUS فعال باشد، یک حساب با نوع `SYSTEM ACCOUNT` قابل ساخت است. Network Map برای Discovery/Refresh/Backup می‌تواند از همین حساب استفاده کند. رمز آن از Browser دریافت نمی‌شود و فقط داخل سرویس با کلید رمزنگاری EMS باز می‌شود.
