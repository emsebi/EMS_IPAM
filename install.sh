#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY="${EMS_REPOSITORY:-emssebi/EMS_IPAM}"
REPOSITORY_REF="${EMS_REPOSITORY_REF:-main}"
INSTALL_DIR="${EMS_INSTALL_DIR:-/opt/ems-ipam}"
SOURCE_OVERRIDE="${EMS_INSTALL_SOURCE_DIR:-}"
TTY_DEVICE="/dev/tty"
TEMP_DIR=""

log() {
  printf '\n[%s] %s\n' "EMS IPAM" "$*"
}

fail() {
  printf '\nخطا: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
    rm -rf -- "$TEMP_DIR"
  fi
}
trap cleanup EXIT

need_command() {
  command -v "$1" >/dev/null 2>&1 || fail "دستور $1 روی سرور نصب نیست."
}

read_default() {
  local variable_name="$1"
  local prompt_text="$2"
  local default_value="$3"
  local entered=""
  read -r -p "$prompt_text [$default_value]: " entered <"$TTY_DEVICE" || fail "خواندن ورودی ممکن نیست."
  printf -v "$variable_name" '%s' "${entered:-$default_value}"
}

read_secret_twice() {
  local variable_name="$1"
  local prompt_text="$2"
  local minimum_length="$3"
  local first=""
  local second=""
  while true; do
    read -r -s -p "$prompt_text: " first <"$TTY_DEVICE" || fail "خواندن رمز ممکن نیست."
    printf '\n'
    if (( ${#first} < minimum_length )); then
      printf 'رمز باید حداقل %s کاراکتر باشد.\n' "$minimum_length" >&2
      continue
    fi
    if [[ "$first" == *"'"* ]]; then
      printf "برای سازگاری با فایل تنظیمات، از علامت ' در رمز استفاده نکنید.\n" >&2
      continue
    fi
    read -r -s -p "تکرار رمز: " second <"$TTY_DEVICE" || fail "خواندن تکرار رمز ممکن نیست."
    printf '\n'
    if [[ "$first" != "$second" ]]; then
      printf 'دو رمز یکسان نیستند؛ دوباره وارد کنید.\n' >&2
      continue
    fi
    printf -v "$variable_name" '%s' "$first"
    return
  done
}

normalize_boolean() {
  local value="${1,,}"
  case "$value" in
    true|yes|y|1) printf 'true' ;;
    false|no|n|0) printf 'false' ;;
    *) return 1 ;;
  esac
}

port_is_busy() {
  local port="$1"
  if ss -H -ltn 2>/dev/null | awk -v suffix=":$port" '$4 ~ suffix "$" { found=1 } END { exit(found ? 0 : 1) }'; then
    return 0
  fi
  if docker ps --format '{{.Ports}}' 2>/dev/null | grep -Eq "(^|[,[:space:]])[^,]*:${port}->"; then
    return 0
  fi
  return 1
}

if (( EUID != 0 )); then
  fail "نصب باید با sudo اجرا شود."
fi

[[ -r "$TTY_DEVICE" ]] || fail "این نصب‌کننده باید داخل ترمینال تعاملی اجرا شود."

for command_name in docker curl tar ss awk grep; do
  need_command "$command_name"
done

docker info >/dev/null 2>&1 || fail "سرویس Docker در دسترس نیست."
docker compose version >/dev/null 2>&1 || fail "افزونه Docker Compose نصب نیست."

if [[ -e "$INSTALL_DIR" ]]; then
  fail "مسیر $INSTALL_DIR از قبل وجود دارد؛ برای جلوگیری از بازنویسی، نصب متوقف شد."
fi

log "تنظیمات نصب"
read_secret_twice POSTGRES_PASSWORD "رمز قوی دیتابیس POSTGRES_PASSWORD" 16

while true; do
  read_default EMS_ADMIN_USERNAME "نام کاربری مدیر EMS_ADMIN_USERNAME" "admin"
  if [[ "$EMS_ADMIN_USERNAME" =~ ^[A-Za-z0-9_.-]{3,80}$ ]]; then
    break
  fi
  printf 'نام کاربری باید ۳ تا ۸۰ کاراکتر و شامل حروف، عدد، نقطه، زیرخط یا خط تیره باشد.\n' >&2
done

read_secret_twice EMS_ADMIN_PASSWORD "رمز مدیر EMS_ADMIN_PASSWORD" 12

while true; do
  read_default EMS_HTTP_PORT "پورت پنل EMS_HTTP_PORT" "8080"
  if [[ "$EMS_HTTP_PORT" =~ ^[0-9]+$ ]]; then
    EMS_HTTP_PORT=$((10#$EMS_HTTP_PORT))
    if (( EMS_HTTP_PORT >= 1 && EMS_HTTP_PORT <= 65535 )); then
      break
    fi
  fi
  printf 'پورت باید عددی بین ۱ تا ۶۵۵۳۵ باشد.\n' >&2
done

while true; do
  read_default cookie_input "آیا پنل پشت HTTPS است؟ COOKIE_SECURE" "false"
  if COOKIE_SECURE="$(normalize_boolean "$cookie_input")"; then
    break
  fi
  printf 'فقط true یا false وارد کنید.\n' >&2
done

if port_is_busy "$EMS_HTTP_PORT"; then
  fail "پورت $EMS_HTTP_PORT اشغال است؛ هیچ کانتینری ایجاد نشد. نصب را دوباره اجرا و پورت دیگری انتخاب کنید."
fi

log "دریافت فایل‌های پروژه"
TEMP_DIR="$(mktemp -d /tmp/ems-ipam-install.XXXXXX)"
SOURCE_DIR="$TEMP_DIR/source"
mkdir -p "$SOURCE_DIR"

if [[ -n "$SOURCE_OVERRIDE" ]]; then
  [[ -d "$SOURCE_OVERRIDE" ]] || fail "مسیر سورس آزمایشی پیدا نشد."
  cp -a "$SOURCE_OVERRIDE/." "$SOURCE_DIR/"
else
  ARCHIVE_URL="https://github.com/${REPOSITORY}/archive/refs/heads/${REPOSITORY_REF}.tar.gz"
  curl -fsSL --retry 3 --connect-timeout 15 "$ARCHIVE_URL" \
    | tar -xz --strip-components=1 -C "$SOURCE_DIR"
fi

for required_path in compose.yml docker-app/Dockerfile docker-app/package.json docker-app/server/main.mjs; do
  [[ -e "$SOURCE_DIR/$required_path" ]] || fail "فایل ضروری $required_path در Repository وجود ندارد."
done

umask 077
{
  printf "POSTGRES_PASSWORD='%s'\n" "$POSTGRES_PASSWORD"
  printf "EMS_ADMIN_USERNAME='%s'\n" "$EMS_ADMIN_USERNAME"
  printf "EMS_ADMIN_PASSWORD='%s'\n" "$EMS_ADMIN_PASSWORD"
  printf "EMS_HTTP_PORT='%s'\n" "$EMS_HTTP_PORT"
  printf "COOKIE_SECURE='%s'\n" "$COOKIE_SECURE"
} > "$SOURCE_DIR/.env"

mkdir -p "$(dirname "$INSTALL_DIR")"
mv "$SOURCE_DIR" "$INSTALL_DIR"
chmod 600 "$INSTALL_DIR/.env"

compose=(docker compose --project-name ems-ipam --env-file "$INSTALL_DIR/.env" -f "$INSTALL_DIR/compose.yml")

log "دریافت ایمیج دیتابیس"
"${compose[@]}" pull db

log "ساخت ایمیج EMS IPAM"
"${compose[@]}" build --pull app

log "راه‌اندازی سرویس"
"${compose[@]}" up -d

log "بررسی سلامت سرویس"
for (( attempt=1; attempt<=60; attempt+=1 )); do
  if curl -fsS --max-time 2 "http://127.0.0.1:${EMS_HTTP_PORT}/health" >/dev/null 2>&1; then
    SERVER_IP="$(hostname -I 2>/dev/null || true)"
    SERVER_IP="${SERVER_IP%% *}"
    printf '\nنصب با موفقیت انجام شد.\n'
    printf 'آدرس پنل: http://%s:%s\n' "${SERVER_IP:-IP-SERVER}" "$EMS_HTTP_PORT"
    printf 'مسیر نصب: %s\n' "$INSTALL_DIR"
    exit 0
  fi
  sleep 2
done

"${compose[@]}" ps >&2 || true
"${compose[@]}" logs --tail 80 app db >&2 || true
fail "سرویس در زمان تعیین‌شده سالم نشد؛ لاگ‌ها در بالا نمایش داده شدند."
