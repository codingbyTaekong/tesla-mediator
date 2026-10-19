# Pi ↔ 뷰어 WebSocket 프로토콜

- 엔드포인트: `wss://<host>/ws`
- 바이너리 프레임: 영상/오디오 (Pi → 뷰어)
- 텍스트 프레임: JSON 제어 메시지 (양방향)

정의는 [`shared/src/protocol.ts`](../shared/src/protocol.ts)에 있고 서버와 뷰어가 같은 코드를 씁니다.
모든 정수는 **리틀 엔디언**입니다.

## 바이너리 (Pi → 뷰어)

첫 바이트가 종류입니다.

### 영상 `kind = 1`

| 오프셋 | 크기 | 필드                                              |
| ------ | ---- | ------------------------------------------------- |
| 0      | u8   | `1`                                               |
| 1      | u8   | flags (bit0 = 키프레임)                           |
| 2      | u16  | width                                             |
| 4      | u16  | height                                            |
| 6      | …    | H.264 Annex B access unit 한 개 (start code 포함) |

키프레임에는 SPS/PPS가 함께 들어 있고, 뷰어는 SPS에서 `avc1.PPCCLL` codec 문자열을 만들어 디코더를 구성합니다.
서버는 새 뷰어에게 키프레임부터 보냅니다.

### 오디오 `kind = 2`

| 오프셋 | 크기 | 필드                     |
| ------ | ---- | ------------------------ |
| 0      | u8   | `2`                      |
| 1      | u8   | channels                 |
| 2      | u32  | sampleRate (Hz)          |
| 6      | …    | Int16 PCM, 채널 인터리브 |

## JSON (Pi → 뷰어)

```jsonc
{ "type": "status", "status": { "dongle": "plugged", "phone": "connected", "source": "carlinkit" } }
// dongle: plugged | unplugged | failure,  phone: connected | disconnected
{ "type": "media", "title": "곡 제목", "artist": "아티스트", "album": "앨범" }
```

`status`는 접속 직후 1회, 이후 바뀔 때마다 전송됩니다.

## JSON (뷰어 → Pi)

```jsonc
{ "type": "hello", "viewport": { "width": 1180, "height": 760 } } // 접속 직후 1회
{ "type": "touch", "action": "down", "x": 0.25, "y": 0.6 }     // action: down | move | up
{ "type": "requestKeyframe" }                                    // 디코더를 다시 시작할 때
```

- `x`, `y`는 **영상 영역 기준 0..1** 좌표입니다(레터박스 제외). 서버는 범위를 벗어난 값을 0..1로 자릅니다.
- `move`는 손가락이 눌린 동안에만 보냅니다. 단일 터치만 지원합니다.
- 알 수 없는 메시지는 무시합니다.
