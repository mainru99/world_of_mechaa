#!/bin/sh
# 효과음 원본(proto/juice/sfx/*.wav)을 게임용 MP3(128kbps)로 만든다. 2026-10-08 용량 정리.
# 사용: sh tools/sfx_encode.sh   (ffmpeg 가 PATH 에 있거나 FFMPEG 환경변수로 경로를 준다)
set -e
cd "$(dirname "$0")/.."
FF="${FFMPEG:-ffmpeg}"
for name in $(node -e "import('./js/audio.js').then(m=>console.log(m.AUDIO_NAMES.join(' ')))"); do
  "$FF" -v error -y -i "proto/juice/sfx/$name.wav" -c:a libmp3lame -b:a 128k -ar 44100 "assets/sfx/$name.mp3"
done
echo "assets/sfx: $(ls assets/sfx/*.mp3 | wc -l) MP3"
