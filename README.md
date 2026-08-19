# EMS IPAM

سامانهٔ چندکاربره و کانتینری برای مدیریت تصویری شبکه و فضای آدرس.

![نمای نمونه EMS IPAM](docs/ems-ipam-preview.png)

## نصب

پیش‌نیاز: Linux دارای Docker Engine، Docker Compose، `curl`، `tar` و `ss`.

```bash
curl -fsSL https://raw.githubusercontent.com/emsebi/EMS_IPAM/main/install.sh | sudo bash
```

اسکریپت یک منوی انگلیسی برای نصب، به‌روزرسانی، پشتیبان‌گیری و دو نوع حذف نمایش می‌دهد. هنگام نصب رمز دیتابیس، نام کاربری و رمز مدیر، پورت پنل و وضعیت HTTPS پرسیده می‌شود. اگر پورت اشغال باشد، نصب پیش از ساخت کانتینرها متوقف می‌شود.

## امکانات

- نمایش /16 به‌شکل خانه‌های /24 و بازکردن یک یا چند جدول /24
- دو نمای `IP Grid` و `Subnet Map` از /32 تا /24
- ایجاد، ویرایش و حذف شرکت، رنج، کاربر، زیرشبکه و اطلاعات IP
- محافظت از آخرین مدیر فعال سامانه
- ثبت اطلاعات، رمز رمزگذاری‌شده و پورت‌های اختصاصی هر IP
- پینگ و نمایش لحظه‌ای تغییرات
- PostgreSQL و اجرای کانتینری با Docker Compose
- کلاینت ویندوز برای Winbox، RDP، PuTTY و VNC

فایل `portainer-stack.yml` نیز برای ساخت Stack در Portainer آماده است.

ساخته‌شده توسط **EMSebi** — `EMSebi@Gmail.Com` — Telegram: `@EMSebi`
