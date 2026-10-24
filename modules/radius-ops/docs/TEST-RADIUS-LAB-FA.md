# راهنمای آزمون و مدل RADIUS روی VM آزمایشگاهی

## مدل عملیاتی

این پروژه برای مدیریت RADIUS از مدل استاندارد FreeRADIUS استفاده می‌کند و مفاهیم EMS را روی آن سوار می‌کند:

- **RADIUS Client / NAS**: همان Client واقعی FreeRADIUS است؛ IP یا CIDR مبدأ واقعی RADIUS و Shared Secret دارد و در جدول استاندارد `nas` همگام می‌شود.
- **Shared Secret Profile**: فقط برای استفاده مجدد و مدیریت Secret در EMS است؛ هر NAS یکی از این Profileها را انتخاب می‌کند.
- **NAS Collection**: فقط یک گروه اسمی از NASهای ثبت‌شده است. داخل Collection هیچ IP/CIDR مستقلی تعریف نمی‌شود. عضویت از فرم خود NAS تعیین می‌شود.
- **Permission Profile**: مشخص می‌کند اگر کاربر روی یک Collection مجاز بود، چه Reply Attributeهایی دریافت کند؛ فعلاً Cisco privilege و MikroTik group.
- **User**: Password در `radcheck` نگهداری می‌شود. در EMS برای هر Collection مجاز، یک Permission Profile انتخاب می‌شود.
- اگر یک NAS عضو چند Collection باشد و یک User از آن مسیرها Profileهای متفاوت بگیرد، ذخیره باید fail-closed شود و تعارض رفع شود.
- IP/CIDR overlap مربوط به **خود NAS Clientها** است، نه Collection. تعریف خاص‌تر NAS باید بر تعریف عمومی‌تر مثل `0.0.0.0/0` اولویت داشته باشد.

این تفکیک مهم است: FreeRADIUS مسئول تشخیص NAS واقعی، Shared Secret، User credential و Reply Attribute است؛ EMS Collection فقط لایه مدیریت و Policy است.

## تست

1. در EMS-IPAM یک NAS آزمایشگاهی ثبت کنید و **IP مبدأ واقعی بسته UDP** آن را وارد کنید؛ این IP لزوماً IP مدیریتی تجهیز نیست. برای MikroTik، مقدار `src-address` در تنظیم RADIUS معیار خوبی برای تشخیص مبدأ است.
2. Shared Secret Profile بسازید و روی NAS انتخاب کنید. Secret را می‌توان از دکمه Show Secret در پنل دید و Copy کرد.
3. یک NAS Collection فقط با نام بسازید، مثلاً `Main Routers`. سپس در فرم NAS، همان Collection را تیک بزنید.
4. Permission Profile بسازید، مثلاً `full` با Cisco privilege 15 و MikroTik group=full.
5. User بسازید و برای Collection موردنظر Permission Profile را انتخاب کنید. Password کوتاه مجاز است ولی پنل هشدار ضعف می‌دهد. Password ذخیره‌شده با Show Password قابل مشاهده است.
6. در RADIUS Diagnostics بررسی کنید Database، FreeRADIUS process، UDP 1812، UDP 1813 و Live Log collector سالم باشند.
7. Live RADIUS Logs را باز کنید و از همان NAS درخواست واقعی بفرستید. برای PAP Reject باید Username، Password attempt، NAS source و نتیجه قابل مشاهده باشد؛ این buffer زنده است و داده credential در گزارش دائمی EMS ذخیره نمی‌شود.
8. با Password درست انتظار Access-Accept و با Password غلط انتظار Access-Reject دارید. Source NAS ناشناخته یا Shared Secret اشتباه باید fail-closed باشد.
9. اگر NAS خاص در کنار fallback عمومی `0.0.0.0/0` وجود دارد، تعریف خاص‌تر باید authoritative باشد و Disable شدن آن نباید باعث مجاز شدن از fallback عمومی شود.
10. EAP/802.1X تا زمان نصب certificate معتبر و تست مستقل EAP غیرفعال می‌ماند. هیچ config شبکه‌ای auto-push نمی‌شود.

## مبنای FreeRADIUS

- NAS clients از SQL `nas` table با `read_clients = yes` خوانده می‌شوند.
- User password از `radcheck` با `Cleartext-Password` برای PAP استفاده می‌شود.
- Reply attributes از `radreply` و `radgroupreply`/group processing می‌آیند.
- EMS برای Policy per-NAS، انتخاب Permission Profile را قبل از Reply attribute به NAS Collection membership متصل می‌کند، بدون ساختن یک client scope موازی با FreeRADIUS.
