# ماژول نقشه شبکه

این پوشه مستقل از هسته مدیریت IP نگهداری می‌شود، اما از همان PostgreSQL و نشست کاربران استفاده می‌کند.

برای به‌روزرسانی فقط این ماژول:

```bash
curl -fsSL https://raw.githubusercontent.com/emsebi/EMS_IPAM/main/modules/network-map/install.sh | sudo bash -s -- update
```

برای غیرفعال‌کردن بدون حذف داده:

```bash
sudo /opt/ems-ipam/modules/network-map/install.sh disable
```

برای فعال‌سازی دوباره:

```bash
sudo /opt/ems-ipam/modules/network-map/install.sh enable
```

رمزهای تجهیزات در جدول‌های این ماژول ستون ذخیره‌سازی ندارند و فقط در حافظه عملیات فعال استفاده می‌شوند.
