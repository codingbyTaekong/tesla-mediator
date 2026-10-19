# Tesla Mediator

아이폰의 **CarPlay** 화면을 테슬라 화면에 띄우고, 테슬라 터치스크린으로 그대로 조작하게 해 주는 차량용 브리지입니다.
내비(T맵·카카오내비·네이버 지도·Google 지도·Apple 지도), YouTube Music, Spotify 등 **CarPlay를 지원하는 앱**을 쓸 수 있습니다.

```
iPhone ──무선 CarPlay──▶ CarPlay 동글 ──USB──▶ Raspberry Pi ──Wi-Fi──▶ 테슬라 브라우저
                                                 (이 프로젝트)            (영상 + 터치)
```

테슬라는 CarPlay를 지원하지 않고, iOS는 다른 앱을 원격 조작하는 것을 허용하지 않습니다.
그래서 Apple 인증(MFi)을 갖춘 시판 CarPlay 동글이 아이폰과 CarPlay로 통신하고,
라즈베리파이가 그 화면을 테슬라 내장 브라우저로 중계하며 터치를 되돌려 보냅니다.

> 현재 상태: **설계 + 골격 단계**. 목업 소스로 서버 → 브라우저 전송과 터치 왕복은 동작하며,
> 실제 동글·실차 테스트는 아직 하지 않았습니다. 진행 상황은 [로드맵](#로드맵)을 보세요.

## 문서

| 문서                                         | 내용                                     |
| -------------------------------------------- | ---------------------------------------- |
| [docs/architecture.md](docs/architecture.md) | 구성 요소, 데이터 흐름, 설계 결정과 한계 |
| [docs/hardware.md](docs/hardware.md)         | 필요한 부품, 배선, 전원, 설치            |
| [docs/network.md](docs/network.md)           | Wi-Fi AP, HTTPS 인증서, 차량 인터넷      |
| [docs/protocol.md](docs/protocol.md)         | Pi ↔ 브라우저 WebSocket 메시지 규격      |

## 저장소 구조

```
shared/   서버와 뷰어가 함께 쓰는 프로토콜 정의, H.264 유틸 (+ 단위 테스트)
server/   Raspberry Pi에서 도는 Node.js 서버: 동글 드라이버, HTTPS/WebSocket
web/      테슬라 브라우저용 뷰어: WebCodecs 디코딩 → canvas, 터치 입력, 오디오
deploy/   Pi 설치 스크립트, hostapd/dnsmasq/systemd/udev 설정
```

## 개발 PC에서 실행 (동글 없이)

Node.js 20 이상과 ffmpeg가 필요합니다.

```bash
npm install
npm run sample -w server   # 테스트 패턴 영상(server/samples/test.h264) 생성
npm run dev                # 목업 소스로 서버 실행 → http://localhost:8443
```

브라우저(H.264를 지원하는 Chrome/Edge/Safari)에서 `http://localhost:8443`을 열면 테스트 패턴이 보이고,
화면을 터치/드래그하면 서버 로그에 정규화된 좌표가 찍힙니다.

```bash
npm test          # 프로토콜/H.264 단위 테스트
npm run lint
npm run typecheck
```

## 테슬라 브라우저 자체 테스트 (하드웨어 없이)

Pi와 동글을 사기 전에, 이 방식이 테슬라 브라우저에서 — 특히 **주행 중에** — 동작하는지 먼저 확인하는 페이지입니다.
실제 뷰어와 같은 코드(WebCodecs → canvas, WebAudio)로 샘플 영상과 테스트음을 재생하고, 1초마다 결과를 기록합니다.

정적 파일이므로 HTTPS가 되는 아무 웹 서버에나 올리면 됩니다.

```bash
npm install
npm run build -w shared && npm run build -w web
# web/dist/ 안의 파일 전체를 서버에 업로드 → https://<도메인>/<경로>/selftest.html
```

- 상대 경로로 빌드되므로 도메인 루트가 아닌 하위 경로에 올려도 됩니다.
- `selftest/sample.mp4`는 `video/mp4`로 제공되어야 합니다(nginx·Apache 기본 설정이면 문제없음).
- GitHub Pages를 쓰려면 **Settings › Pages › Source**를 **GitHub Actions**로 바꾼 뒤
  **Actions › Deploy web to GitHub Pages › Run workflow**를 실행합니다.

테스트 방법:

1. 정차 중 테슬라 브라우저에서 위 주소를 열고 **테스트 시작**을 누릅니다(위치 권한을 허용하면 주행/정차가 자동 구분됩니다).
2. 그대로 몇 분 주행합니다. 운전 중에는 화면을 조작하지 마세요.
3. 주차 후 같은 주소를 다시 열면 **타임라인**과 **이벤트 기록**이 남아 있습니다.

| 항목             | 확인하는 것                               |
| ---------------- | ----------------------------------------- |
| ① canvas 영상    | 실제 앱 방식. 주행 중에도 초록색이면 성공 |
| ② `<video>` 영상 | 비교용. 주행 중 멈추는지(빨간색) 확인     |
| ③ 소리           | WebAudio가 주행 중에도 계속 나는지        |
| ④ 터치           | 좌표 정확도, 동시 터치 개수               |

## 라즈베리파이에 설치

[docs/hardware.md](docs/hardware.md)의 부품을 준비한 뒤:

```bash
git clone https://github.com/codingbyTaekong/tesla-mediator.git
cd tesla-mediator
sudo ./deploy/setup-pi.sh '<AP 비밀번호>' '<인증서 도메인>'
```

그다음 [docs/network.md](docs/network.md)대로 HTTPS 인증서를 넣고, 테슬라를 `TeslaMediator` Wi-Fi에 연결한 뒤
테슬라 브라우저에서 `https://<인증서 도메인>/`을 엽니다. 아이폰은 **설정 › 일반 › CarPlay**에서 동글을 한 번 페어링하면 이후 자동 연결됩니다.

### 실차 수동 테스트 체크리스트

- [ ] 시동 후 Pi가 부팅되고 `TeslaMediator` AP가 뜬다
- [ ] 테슬라 브라우저에서 페이지가 열리고 "아이폰을 기다리는 중…"이 보인다
- [ ] 아이폰이 CarPlay로 연결되면 화면이 나온다
- [ ] 터치/스크롤/지도 드래그가 정확한 위치에 먹는다
- [ ] 음악/내비 안내음이 나온다 (WebAudio 또는 블루투스)
- [ ] **주행 중(D단)** 에도 영상·터치·소리가 유지된다
- [ ] 아이폰 연결이 끊겼다 다시 붙으면 자동 복구된다

## 로드맵

1. **골격 (현재)** — 프로토콜, 목업 소스, 뷰어, 배포 스크립트, 테슬라 브라우저 자체 테스트
2. **동글 연동** — 실제 Carlinkit 동글로 영상/터치/오디오 검증, 해상도·FPS 튜닝
3. **실차 검증** — 주행 중 동작, 지연 측정, 오디오 경로 확정(WebAudio vs 블루투스)
4. **사용성** — 야간 모드 연동, 상태 화면, 핸들 버튼/음성(Siri) 마이크 경로
5. **배포 편의** — Pi 이미지 배포, 인증서 자동 갱신

## 주의

- 운전 중 화면 조작은 주의를 분산시킵니다. 각국 법규를 지키고 정차 중에 조작하세요.
- 테슬라 소프트웨어 업데이트로 브라우저 동작이 바뀌면 일부 기능이 영향을 받을 수 있습니다.
- CarPlay는 Apple Inc.의 상표이며, 이 프로젝트는 Apple 또는 Tesla와 관련이 없습니다.
- 동글 USB 프로토콜은 [node-carplay](https://github.com/rhysmorgan134/node-CarPlay) (MIT)를 사용합니다.
