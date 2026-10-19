#!/bin/sh
# MockDongle용 테스트 영상(H.264 Annex B)을 만든다. ffmpeg 필요.
set -e
cd "$(dirname "$0")/.."
mkdir -p samples
W="${MEDIATOR_WIDTH:-1280}"
H="${MEDIATOR_HEIGHT:-800}"
FPS="${MEDIATOR_FPS:-30}"
ffmpeg -y -loglevel error \
  -f lavfi -i "testsrc2=size=${W}x${H}:rate=${FPS}" -t 10 \
  -c:v libx264 -profile:v baseline -pix_fmt yuv420p -tune zerolatency \
  -g "$FPS" -bf 0 -f h264 samples/test.h264
echo "samples/test.h264 생성 완료 (${W}x${H}@${FPS})"
