# مرحله 01 — Base + IPAM

این مرحله پایه ثابت EMS IPAM است و باید بدون هیچ افزونه‌ای قابل استفاده باشد.

## شامل

- Login / Logout / Profile
- Light / Dark theme و ذخیره ترجیح کاربر
- User / Role / Module permissions
- Company / Site / Branch / Customer
- اطلاعات تماس، آدرس، Latitude/Longitude، WAN/Public IP و Notes
- Personnel با کد پرسنلی و جست‌وجوی سریع
- Device Inventory مشترک و قابل ویرایش
- Global Search
- Audit
- Backup دستی و زمان‌بندی‌شده
- PostgreSQL مشترک برای تمام ماژول‌های آینده
- IPAM کامل با Address Space، Range و IP

## رفتار IPAM

- Root Address Space از /16 تا /24
- نمای اصلی: جدول عمودی CIDR با /24 در سمت چپ
- اندازه هر /23 دو برابر /24، /22 چهار برابر /24 و به همین ترتیب تا /16
- کلیک روی متن CIDR: ورود به همان رنج
- کلیک روی مربع رنگ: نام، توضیح و رنگ همان رنج
- رنگ به Child ارث نمی‌رسد
- رنگ جدید به صورت خودکار پیشنهاد می‌شود و قابل تغییر است
- Drill-down زیر /24: /25 → /26 → /27 → /28 → /29 → /30 → چهار IP
- /31 به عنوان سطح نمایشی جدا نشان داده نمی‌شود
- IP Detail: Previous / Next، Save، Delete، Ping، VLAN، MAC، Owner، Location و Notes

## داده آزمایشی

تمام داده‌های Demo و Documentation ساختگی هستند. هیچ داده واقعی سازمانی نباید داخل Repository یا تصاویر عمومی قرار گیرد.
