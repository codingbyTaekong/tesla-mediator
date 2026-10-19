# 네트워크

## 구성

```
테슬라 ──Wi-Fi "TeslaMediator"──▶ Pi wlan0 (10.42.0.1)
                                  ├ hostapd  : AP
                                  ├ dnsmasq  : DHCP (10.42.0.10~50) + 도메인 → 10.42.0.1
                                  └ server   : HTTPS 443 (/ = 뷰어, /ws = WebSocket)
```

설정 파일은 `deploy/`에 있고 `deploy/setup-pi.sh`가 설치합니다.

| 파일                            | 설치 위치                            |
| ------------------------------- | ------------------------------------ |
| `deploy/hostapd.conf`           | `/etc/hostapd/hostapd.conf`          |
| `deploy/dnsmasq.conf`           | `/etc/dnsmasq.d/tesla-mediator.conf` |
| `deploy/tesla-mediator.service` | `/etc/systemd/system/`               |
| `deploy/99-carlinkit.rules`     | `/etc/udev/rules.d/`                 |

## HTTPS 인증서

뷰어가 쓰는 WebCodecs는 HTTPS에서만 동작하고, 테슬라 브라우저에는 자체 인증서를 신뢰시키는 메뉴가 없습니다.
그래서 **실제로 소유한 도메인**의 인증서를 쓰고, 그 도메인을 Pi의 dnsmasq가 `10.42.0.1`로 응답하게 합니다.

1. 도메인 하나를 준비합니다 (예: `car.example.com`). 공개 DNS에 A 레코드는 없어도 됩니다.
2. 인터넷이 되는 곳에서 **DNS-01 챌린지**로 Let's Encrypt 인증서를 발급합니다. HTTP 챌린지는 Pi가 외부에서 보이지 않으므로 쓸 수 없습니다.
   ```bash
   # 예: Cloudflare DNS를 쓰는 경우
   sudo certbot certonly --dns-cloudflare --dns-cloudflare-credentials ~/cf.ini -d car.example.com
   ```
3. `fullchain.pem`, `privkey.pem`을 Pi의 `/opt/tesla-mediator/certs/`에 복사하고 `sudo systemctl restart tesla-mediator`.
4. `setup-pi.sh`의 두 번째 인자로 같은 도메인을 줬다면 테슬라 브라우저에서 `https://car.example.com/`으로 접속됩니다.

인증서는 90일마다 갱신해야 합니다(로드맵 5단계에서 자동화).
경로는 `MEDIATOR_TLS_CERT`, `MEDIATOR_TLS_KEY` 환경 변수로 바꿀 수 있습니다. 인증서가 없으면 서버는 HTTP로 뜨며, 이 경우 `localhost`에서만 개발용으로 동작합니다.

## 차량 인터넷

테슬라가 Wi-Fi에 연결되면 인터넷도 Wi-Fi로 보내려 할 수 있습니다. Pi AP에는 인터넷이 없으므로:

- **기본**: 대부분의 경우 테슬라가 인터넷 없는 Wi-Fi를 감지하고 LTE를 계속 사용합니다. → **실차 확인 필요**
- **문제가 되면**: Pi에 USB Wi-Fi 어댑터(`wlan1`)를 추가해 아이폰 개인용 핫스팟에 연결하고, `wlan0` → `wlan1`로 NAT를 걸어 인터넷을 공유합니다.
  ```bash
  sudo sysctl -w net.ipv4.ip_forward=1
  sudo iptables -t nat -A POSTROUTING -o wlan1 -j MASQUERADE
  ```
  이때 dnsmasq에 업스트림 DNS(`server=1.1.1.1`)도 추가합니다.

## 포트와 환경 변수

| 변수                                 | 기본값                       | 설명                                           |
| ------------------------------------ | ---------------------------- | ---------------------------------------------- |
| `MEDIATOR_SOURCE`                    | `carlinkit`                  | `mock`이면 샘플 영상 재생                      |
| `MEDIATOR_PORT`                      | `8443` (systemd에서는 `443`) | 서버 포트                                      |
| `MEDIATOR_WIDTH` / `MEDIATOR_HEIGHT` | `1280` / `800`               | CarPlay 렌더링 해상도 (테슬라 화면 비율 16:10) |
| `MEDIATOR_FPS`                       | `30`                         | 프레임률                                       |
| `MEDIATOR_DPI`                       | `160`                        | CarPlay UI 크기. 높이면 아이콘이 커짐          |
