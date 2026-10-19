#!/usr/bin/env bash
# Raspberry Pi OS (Bookworm, 64-bit)에서 Tesla Mediator를 설치한다.
#   sudo ./deploy/setup-pi.sh <AP 비밀번호> [인증서 도메인]
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "sudo로 실행하세요." >&2
  exit 1
fi

PASSWORD="${1:?AP 비밀번호를 첫 번째 인자로 주세요 (8자 이상)}"
DOMAIN="${2:-mediator.lan}"
APP_DIR=/opt/tesla-mediator
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> 패키지 설치"
apt-get update
apt-get install -y hostapd dnsmasq libudev-dev build-essential curl rsync
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> 서비스 사용자"
id mediator >/dev/null 2>&1 || useradd --system --groups plugdev --home "$APP_DIR" mediator

echo "==> 앱 빌드"
mkdir -p "$APP_DIR"
rsync -a --delete --exclude node_modules --exclude .git --exclude certs "$SRC_DIR/" "$APP_DIR/"
cd "$APP_DIR"
npm ci
npm run build
chown -R mediator:mediator "$APP_DIR"

echo "==> Wi-Fi AP (wlan0 = 10.42.0.1)"
# Bookworm은 NetworkManager가 wlan0을 관리하므로 AP 용도로 빼 둔다.
if command -v nmcli >/dev/null; then
  nmcli device set wlan0 managed no || true
fi
ip addr flush dev wlan0 || true
ip addr add 10.42.0.1/24 dev wlan0 || true
cat > /etc/systemd/system/mediator-wlan0-ip.service <<UNIT
[Unit]
Description=Static IP for Tesla Mediator AP
Before=hostapd.service dnsmasq.service
[Service]
Type=oneshot
ExecStart=/usr/sbin/ip addr replace 10.42.0.1/24 dev wlan0
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
UNIT

sed "s/CHANGE_ME_PASSWORD/${PASSWORD}/" deploy/hostapd.conf > /etc/hostapd/hostapd.conf
sed "s/MEDIATOR_DOMAIN/${DOMAIN}/" deploy/dnsmasq.conf > /etc/dnsmasq.d/tesla-mediator.conf
cp deploy/99-carlinkit.rules /etc/udev/rules.d/
udevadm control --reload-rules

echo "==> 서비스 등록"
cp deploy/tesla-mediator.service /etc/systemd/system/
systemctl daemon-reload
systemctl unmask hostapd
systemctl enable --now mediator-wlan0-ip hostapd dnsmasq tesla-mediator

cat <<DONE

설치 완료.
 1. 테슬라에서 Wi-Fi "TeslaMediator"에 접속
 2. 인증서를 $APP_DIR/certs/{fullchain,privkey}.pem 에 두고 'systemctl restart tesla-mediator'
 3. 테슬라 브라우저에서 https://${DOMAIN}/ 열기
자세한 내용은 docs/network.md 참고.
DONE
