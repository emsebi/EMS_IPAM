# RADIUS / MAB در EMS IPAM v0.7.0

## FreeRADIUS Clients

مدیر می‌تواند تک IP یا CIDR کامل را با Shared Secret تعریف کند:

```text
10.10.0.0/16
192.168.0.0/16
10.10.22.10/32
```

به این ترتیب برای صدها Access Switch لازم نیست Client تک‌تک در FreeRADIUS ایجاد شود.

## کاربران تجهیزات

- MikroTik: none / read / write / full
- Cisco IOS/IOS-XE: privilege 0 تا 15
- Cisco NX-OS: network-operator / network-admin
- Human User و SYSTEM ACCOUNT

## MAB

رکورد هر MAC شامل نام، توضیح، نوع دستگاه، شرکت، وضعیت، Policy و VLAN اختیاری است.

### Allow

RADIUS دستگاه را قبول می‌کند و VLAN پورت سوییچ تغییر نمی‌کند.

### Allow + VLAN

RADIUS Attributeهای VLAN را برمی‌گرداند و سوییچ در صورت پشتیبانی Dynamic VLAN را اعمال می‌کند.

### Block / Disabled

همیشه Reject می‌شود؛ حتی اگر Unknown MAC Policy روی Allow یا Quarantine باشد.

## Unknown MAC Policy

- Reject
- Quarantine VLAN
- Allow

این گزینه از Settings قابل تغییر است.

## Configuration Generator

پنل نمونه دستورات Cisco AAA، MikroTik Login RADIUS و Cisco MAB را تولید می‌کند. این دستورات نمونه هستند و Admin قبل از اعمال باید با مدل/نسخه تجهیز خودش تطبیق دهد.

## 802.1X

v0.7.0 یک پیاده‌سازی کامل 802.1X نیست. طراحی برای توسعه آینده آماده شده، اما قابلیت فعلی Network Access بر MAB متمرکز است و وابستگی اجباری به Active Directory یا PKI ندارد.
