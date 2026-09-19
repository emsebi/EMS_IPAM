# تغییرات EMS IPAM نسخه 0.7.0

## یکپارچه‌سازی پروژه

- Network Map مستقل نسخه قبل وارد Release اصلی شد.
- ماژول جدید RADIUS / Network Access اضافه شد.
- هر دو ماژول از PostgreSQL و Session هسته EMS استفاده می‌کنند.
- نصب‌کننده امکان فعال/غیرفعال کردن ماژول‌ها را دارد.

## Network Map

- Discovery با CDP و LLDP از Seed Switch.
- Snapshotهای تاریخی توپولوژی.
- Inventory سوییچ، Port، VLAN، MAC Table، Model، Serial، OS و Uptime.
- جست‌وجوی VLAN روی تمام سوییچ‌های Snapshot.
- MAC Finder با ترجیح پورت غیر-Uplink.
- افزودن دستی سوییچ‌هایی که Discovery پیدا نکرده است.
- اتصال اطلاعات Switch به رکورد موجود IPAM.
- حساب `SYSTEM ACCOUNT` برای Discovery، Refresh و Backup.
- Backup کمکی کانفیگ و Compare تغییرات.
- تشخیص پایه RADIUS/MAB/802.1X در صورت وجود اطلاعات کافی.

## RADIUS

- FreeRADIUS به‌عنوان ماژول اختیاری.
- تعریف Client با CIDR بزرگ یا `/32` و Shared Secret.
- Secretها و رمز حساب‌های تجهیز به‌صورت AES-256-GCM ذخیره می‌شوند.
- دسترسی جداگانه MikroTik، Cisco privilege و Nexus role.
- تفکیک Human User و SYSTEM ACCOUNT.
- تولید نمونه Configuration برای Cisco، MikroTik و MAB.

## Network Access / MAB

- MAC با حالت Allow، Allow + VLAN یا Block.
- VLAN اختصاصی اختیاری برای هر MAC.
- Unknown MAC Policy قابل تغییر: Reject / Quarantine / Allow.
- Block و Disabled همیشه از Policy عمومی اولویت بالاتری دارند.
- Baseline اولیه MACها از Snapshot نقشه با حذف MACهای Uplink-only.
- نگهداری تعداد محدود آخرین Locationهای MAC.

## کاربران و دسترسی

- نقش‌های Admin، Technical، Helpdesk و Branch.
- Helpdesk می‌تواند MAC را پیدا و Add/Edit/Enable/Disable کند.
- Branch فقط اطلاعات شرکت/رنج‌های مجاز خود را می‌بیند.
- نقش‌های Editor/Viewer قدیمی برای سازگاری Upgrade حفظ شدند.

## جست‌وجو

- جست‌وجوی اصلی IPAM علاوه بر IP/Name/Prefix، MACهای Network Access را نیز پیدا می‌کند.
- جست‌وجوی Network Map برای MAC و VLAN تکمیل شد.

## امنیت و پایداری

- کلید رمزنگاری 64 کاراکتر Hex در نصب ساخته می‌شود.
- کلید رمزنگاری داخل Backup دیتابیس نیز حفظ می‌شود.
- Core قبل از شروع ماژول‌های وابسته Health Check می‌شود تا Schema اصلی آماده باشد.
- Credential دستی Discovery در دیتابیس ذخیره نمی‌شود.
- FreeRADIUS صریحاً MACهای Block/Disabled را Reject می‌کند.

## آینده

- 802.1X/EAP و Active Directory به‌صورت Optional قابل توسعه هستند، اما در این نسخه فعال نشده‌اند تا Core و MAB وابستگی غیرضروری پیدا نکنند.
