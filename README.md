# EMS IPAM

سامانهٔ چندکاربره و کانتینری مدیریت تصویری شبکه و فضای آدرس.

## نصب یک‌خطی روی Ubuntu دارای Docker

```bash
curl -fsSL https://raw.githubusercontent.com/emssebi/EMS_IPAM/main/install.sh | sudo bash
```

نصب‌کننده به‌ترتیب این مقادیر را می‌پرسد:

- `POSTGRES_PASSWORD`: رمز دیتابیس؛ حداقل ۱۶ کاراکتر
- `EMS_ADMIN_USERNAME`: نام کاربری مدیر؛ پیش‌فرض `admin`
- `EMS_ADMIN_PASSWORD`: رمز مدیر؛ حداقل ۱۲ کاراکتر
- `EMS_HTTP_PORT`: پورت پنل؛ پیش‌فرض `8080`
- `COOKIE_SECURE`: برای HTTP مقدار `false` و برای Reverse Proxy دارای HTTPS مقدار `true`

اگر پورت انتخاب‌شده اشغال باشد، نصب قبل از ساخت یا اجرای کانتینرها متوقف می‌شود.

پیش‌نیازها:

- Ubuntu یا Linux دارای `Docker Engine`
- افزونهٔ `Docker Compose`
- دستورهای `curl`، `tar` و `ss`

فایل‌ها در `/opt/ems-ipam` نصب می‌شوند. تنظیمات محرمانه داخل فایل `/opt/ems-ipam/.env` با سطح دسترسی `600` قرار می‌گیرند. دیتابیس در Volume دائمی `ems_ipam_database` نگهداری می‌شود و پورت PostgreSQL روی شبکه منتشر نمی‌شود.

پس از نصب، کانتینرها و Volume در Portainer قابل مشاهده هستند. فایل `portainer-stack.yml` نیز برای ساخت دستی Stack در Portainer قرار داده شده است.

## امکانات اصلی

- گروه‌بندی شرکت‌ها و چند رنج اصلی برای هر شرکت
- نمایش تصویری `/16` تا `/24` و صفحهٔ ۲۵۶ خانه‌ای هر `/24`
- نمایش نوارهای تو‌در‌توی رنج‌های والد و فرزند
- ثبت اطلاعات و پورت‌های اتصال مستقل برای هر IP
- پینگ و نمایش وضعیت سبز، قرمز یا بررسی‌نشده
- کاربران مدیر، ویرایشگر و مشاهده‌گر
- دسترسی کاربران به شرکت‌های مشخص
- ثبت تاریخچهٔ تغییرات و نمایش لحظه‌ای تغییرات
- دیتابیس PostgreSQL و پشتیبان‌گیری مستقل
- کلاینت ویندوز برای Winbox، RDP، PuTTY و VNC

## ساختار Repository

```text
EMS_IPAM/
├── install.sh
├── compose.yml
├── portainer-stack.yml
├── .env.example
├── .gitignore
├── VERSION
├── README.md
├── docker-app/
│   ├── Dockerfile
│   ├── package.json
│   ├── package-lock.json
│   ├── public/
│   └── server/
└── windows-client/
    ├── Install.cmd
    ├── Install-EMS-Client.ps1
    ├── EMS-IPAM-Protocol.ps1
    ├── Uninstall-EMS-Client.ps1
    └── ems-client.json
```

## پشتیبان‌گیری

```bash
cd /opt/ems-ipam
docker compose --project-name ems-ipam --env-file .env -f compose.yml \
  exec -T db pg_dump -U ems_ipam -d ems_ipam -Fc > ems-ipam.backup
```

فایل پشتیبان را خارج از سرور Docker نیز نگهداری کنید.

## هشدار امنیتی

پنل را مستقیم روی اینترنت عمومی منتشر نکنید. برای دسترسی بیرونی از VPN یا Reverse Proxy دارای HTTPS و کنترل دسترسی استفاده کنید. رمز واقعی تجهیزات داخل EMS IPAM ذخیره نشود.
