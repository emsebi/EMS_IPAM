EMS_IPAM - Stage 01 / Core + Database + Installer
Version: 1.0.0-stage1

این ZIP برای Merge مستقیم با ریشه Repository زیر ساخته شده است:
https://github.com/emsebi/EMS_IPAM

محتویات ZIP را Extract و در ریشه Repository قرار دهید.
install.sh و compose.yml باید مستقیماً در ریشه GitHub دیده شوند.

این مرحله شامل Core، دیتابیس، Installer، Company/Site، Personnel، Inventory، Settings، Audit، Backup دستی و زیرساخت Module Loader است.
IPAM در Stage 02 به صورت modules/ipam اضافه می‌شود.

نصب/آپدیت:
curl -fsSL https://raw.githubusercontent.com/emsebi/EMS_IPAM/main/install.sh | sudo bash
