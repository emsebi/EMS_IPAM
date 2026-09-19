# ماژول RADIUS / Network Access

این ماژول در EMS IPAM v0.7.0 دو کاربرد مستقل اما مرتبط دارد:

1. مدیریت دسترسی کارشناسان به تجهیزات شبکه با FreeRADIUS.
2. کنترل MAC کلاینت‌ها با MAB و VLAN اختیاری.

## RADIUS Network

Clientهای RADIUS می‌توانند به‌صورت IP تکی (`/32`) یا CIDR تعریف شوند. نمونه:

```text
10.10.0.0/16
```

هر Network دارای Shared Secret مستقل است. Secret در رابط دوباره نمایش داده نمی‌شود.

## Equipment Users

- MikroTik: none / read / write / full
- Cisco IOS/IOS-XE: privilege 0 تا 15
- Cisco NX-OS: none / network-operator / network-admin
- نوع حساب: Human User یا SYSTEM ACCOUNT

SYSTEM ACCOUNT برای Discovery، Refresh و Backup در Network Map قابل استفاده است.

## MAC Network Access

هر MAC یکی از سه Policy زیر را دارد:

- Allow: اجازه اتصال و حفظ VLAN پورت سوییچ
- Allow + VLAN: اجازه اتصال و برگرداندن Dynamic VLAN از RADIUS
- Block: رد صریح

MAC غیرفعال نیز همیشه Reject می‌شود.

Policy عمومی MAC ناشناس از Settings روی Reject، Quarantine VLAN یا Allow قابل تغییر است.

## 802.1X

در v0.7.0 پیاده‌سازی عملیاتی روی MAB متمرکز است. ساختار پروژه برای توسعه بعدی 802.1X/EAP آماده شده، اما در این نسخه به Active Directory، PKI یا 802.1X وابستگی اجباری وجود ندارد.
