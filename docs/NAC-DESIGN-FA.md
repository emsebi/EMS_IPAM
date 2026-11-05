# ماژول 05 — 802.1X / NAC — طرح مهندسی و مرز تحویل

## هدف
کنترل ورود تجهیزات بر اساس MAC، با پروفایل متفاوت برای هر سوئیچ و قابلیت ارتقا به NAC سازمانی. این طرح از \`network-access\` موجود و مخزن \`radius-ops\` استفاده می‌کند و سامانهٔ RADIUS موازی نمی‌سازد.

## مدل اطلاعات (از حالا)

| موجودیت | مالک داده | نقش |
|---|---|---|
| NAS / سوئیچ + IP + RADIUS secret | \`radius-ops\` | یک دستگاه ثبت‌شده با NAS ID ثابت؛ نه کپی Company/Secret |
| MAC کشف‌شده، IP، نام دستگاه | \`ipam\` / \`network-map\` | فقط مشاهده؛ **هرگز مجوز خودکار** |
| MAC تأییدشده / فعال یا مسدود | \`radius-ops\` | منبع احراز هویت واقعی MAB |
| پروفایل NAC | \`network-access\` | رفتار MAC شناخته‌شده و ناشناس |
| تخصیص سوئیچ به پروفایل | \`network-access\` | پروفایل جدا برای NAS A و B |
| استثنای MAC روی سوئیچ | \`network-access\` | ممنوع‌سازی یا VLAN خاص برای همان NAS |
| پورت/نسخه/حالت Host | فاز سازگاری بعدی | single-host, multi-domain, multi-auth و محدودیت‌های واقعی |
| Accounting/CoA/Posture | فاز مجزا | نیازمند قرارداد runtime، لاگ و تست مستقل |

**پیش‌فرض امنیتی:** بدون NAS، بدون Binding، بدون پروفایل فعال یا MAC مسدود → Reject. برای MAC ناشناس پروفایل دو حالت دارد: Reject، یا Reject از RADIUS و هدایت سوئیچ به VLAN مهمان با قابلیتی که همان سوئیچ پشتیبانی کند. برای MAC تأییدشده: Reject، VLAN پورت، VLAN ثابت یا VLAN اختصاصی ثبت‌شده همان MAC. استثنای MAC فقط برای MAC تأییدشده می‌تواند مجوز جدید ایجاد کند؛ MAC مشاهده‌شده در IPAM مجوز نیست.

## جدول نمونهٔ سناریو

| سوئیچ | پروفایل | MAC ناشناس | MAC تأییدشده | MAC مسدود |
|---|---|---|---|---|
| A | Guest-70 | مهمان در VLAN 70 روی پورت سازگار | VLAN 14 | Reject |
| B | Guest-80 | مهمان در VLAN 80 روی پورت سازگار | VLAN پورت | Reject |
| C | Strict | Reject | VLAN انتخاب‌شده | Reject |
| D | Exception | Reject | سیاست عادی؛ برخی MACها استثنا | Reject |

این جدول نمونه است، نه تنظیمات اجراشده در شبکه.

## تفاوت مهم VLAN و علت عدم استفاده از دستور یکسان برای همهٔ سوئیچ‌ها

- Catalyst 3750 IOS 12.2(55)SE: MAB در حالت پشتیبانی‌شده می‌تواند کلاینت ناشناس را پس از رد احراز هویت به guest VLAN ببرد؛ voice VLAN و multi-auth محدودیت مهم دارند. راهنمای مرجع:
  https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst3750/software/release/12-2_55_se/configuration/guide/scg3750/sw8021x.html
- MikroTik RouterOS: در \`/interface dot1x server\`، \`reject-vlan-id\` پاسخ Access-Reject را به VLAN خاص می‌برد، ولی \`guest-vlan-id\` برای کلاینت فاقد 802.1X و بدون fallback مربوط است؛ \`server-fail-vlan-id\` مخصوص قطع ارتباط با RADIUS است. VLAN filtering و نسخه/قابلیت سخت‌افزار باید کنترل شوند:
  https://help.mikrotik.com/docs/spaces/ROS/pages/328090/Dot1X
- NAS فقط از UDP/IP مبدأ واقعی RADIUS شناخته شود، نه هدر NAS-IP-Address ارسالیِ قابل‌دستکاری؛ ابهام IP/CIDR و عدم ثبت NAS باید fail closed شود.
- خطای رمز EAP، MAC ناشناس، RADIUS قطع‌شده، endpoint فاقد supplicant و reauth پنج رخداد متفاوت هستند و نباید از یک تنظیم VLAN واحد برای همه استفاده شود.
- با چند MAC روی یک پورت، تلفن + کامپیوتر، AP/ترانک یا سوییچ پایین‌دست، قابلیت‌های host mode و guest VLAN تغییر می‌کند؛ پورت‌ها باید ثبت و نوعشان مشخص شود.

## سیاست رول‌اوت

1. **حال حاضر (پیاده‌شده در PR):** Schema، UI، Profile، per-NAS binding، MAC exception، dry-run، متن دستورات جهت بازبینی. هیچ \`Access-Accept\` جدید صادر نمی‌شود.
2. **گام ۲:** اضافه‌شدن نسخهٔ سوئیچ، نقش پورت، لیست پورت‌های مستثنا (uplink, trunk, voice, AP, management)، template سازگاری و preflight checks؛ دستور CLI فقط با نسخه و مدل تأییدشده صادر شود.
3. **گام ۳:** اتصال سیاست به درخواست واقعی FreeRADIUS و تست در NAS آزمایشی، بدون تغییر login مدیران و NAS Collections. تأیید حالت Reject/Guest/Dynamic VLAN و ثبت لاگ MAC+NAS+Port+VLAN.
4. **گام ۴:** فعال‌سازی مرحله‌ای تک‌پورت، ابزار مشاهده و rollback، سپس VLAN/ACL/CoA، احراز هویت 802.1X مبتنی بر گواهی با CA، مدیریت certificate renewal و HA.
5. **بعداً:** قرنطینه، مهمان دارای پرتال، پالیسی بر اساس شخص/دستگاه و posture فقط پس از تست‌های تهدید، محرمانگی و عملکرد.

## مواردی که نباید بی‌اجازه دستکاری شوند

پروفایل‌های RADIUS مدیریت تجهیزات Full/Read، رمز/Secretها و قابلیت reveal، NAS Collections، IPAM Company، فرم‌های Personnel، Smart Network Map، Radio و Portainer/Compose/VM موجود. هیچ پورت/سوئیچ واقعی نباید scan یا config push شود مگر با هدف صریح و مرحلهٔ ایمن.

## معیار نسخهٔ قابل استفاده در شبکه

\`draft\` با \`enforced\` یکسان نیست. تحویل نهایی کنترل دسترسی، علاوه بر تست API و UI، به تست واقعی RADIUS UDP، سناریوی سرور خراب، reauthentication، تست voice و single/multi-host، VLAN trunk و management recovery روی همان مدل و همان نسخهٔ IOS/RouterOS نیاز دارد. وضعیت تست هر SHA و نصب روی VM در PR و چت خروجی مرکزی ثبت شود.
