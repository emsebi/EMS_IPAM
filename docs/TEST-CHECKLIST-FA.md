# چک‌لیست تست Base v1.4.0-stage1

این نسخه برای تست «هسته + مدیریت IP» است و باید فقط با داده آزمایشی تست شود.

## نصب تازه
- Installer باید Docker Engine، Docker Compose و Portainer را بررسی کند.
- رمز PostgreSQL، نام Admin، رمز Admin و Web Port را بپرسد.
- Login و Logout باید کار کنند.

## ظاهر و تنظیمات پایه
- کلید Theme بالا Light/Dark را عوض کند.
- تنظیمات ظاهر دکمه اعمال/ذخیره داشته باشد.
- منوی Admin شامل Profile/Users/About/Logout باشد.

## کاربران و دسترسی ماژول‌ها
- Admin بتواند User بسازد، ویرایش/حذف و فعال/غیرفعال کند.
- Role و دسترسی ماژول‌ها مستقل قابل انتخاب باشد.
- کاربر بدون دسترسی IPAM نباید Company/IPAM را ببیند.

## شرکت، شعبه و پرسنل
- Company/Site/Branch ساخت/ویرایش/حذف شود.
- اطلاعات تماس، آدرس، مختصات، توضیحات و Public/WAN links قابل ویرایش باشد.
- Personnel با کد پرسنلی ثبت شود و روی Company/Branch دیده شود.

## Subnet Overview
- ستون /24 سمت چپ و /23 تا /16 به‌ترتیب دیده شوند.
- ارتفاع واقعی باشد: /23=2x/24، /22=4x/24، /21=8x/24 و ...
- کلیک CIDR دقیقاً همان CIDR را باز کند.
- مربع رنگ کنار Range فقط همان Range را نام‌گذاری/رنگ کند.
- رنگ Parent به Child ارث نرسد.
- Range بدون Group خاکستری بماند.

## زیر /24
- /24 تا /30 خرد شود.
- /31 به‌عنوان سطح نمایشی نشان داده نشود.
- /30 مستقیماً چهار IP را نشان دهد.
- Table پیش‌فرض و Tile اختیاری باشد.

## IP Details
- Previous / Next کار کند.
- Ping status نمایش داده شود.
- Services/Ports و میانبرهای Web/HTTPS/SSH/RDP/WinBox قابل ویرایش/استفاده باشند.
- Edit/Delete و ذخیره اطلاعات IP کار کند.

## Search
- IP/MAC/Hostname/Company/Personnel با بخشی از عبارت نتیجه بدهد.
- Up/Down/Enter برای انتخاب پیشنهادها کار کند.

## تست Update بدون از دست رفتن اطلاعات
1. یک Company، Personnel، Range و چند IP آزمایشی بسازید.
2. Installer را دوباره اجرا و گزینه Update را انتخاب کنید.
3. Update باید قبل از تغییر فایل‌ها Backup معتبر DB بسازد.
4. بعد از Update همان اطلاعات باید باقی مانده باشد.
