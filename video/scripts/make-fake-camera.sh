#!/usr/bin/env bash
# Builds a fake webcam feed for Chromium (--use-file-for-fake-video-capture):
# an Apache-2.0 sample photo from google-ai-edge/mediapipe-samples-web, cropped
# to a waist-up framing. 5 s upright, then 7 s tilted 12 degrees so the app has
# something to say. Chromium loops the file. Run from video/.
set -euo pipefail

out=${1:-person.y4m}
curl -fsSL -o person.jpg \
  https://raw.githubusercontent.com/google-ai-edge/mediapipe-samples-web/main/public/images/id_photos/id_fail_distant_waist_up.jpg
ffmpeg -loglevel error -y -loop 1 -t 12 -i person.jpg -r 15 -filter_complex "\
[0]crop=480:640:208:480,scale=480:640,split[a][b];\
[a]trim=0:5,setpts=PTS-STARTPTS[up];\
[b]rotate=12*PI/180:fillcolor=black,trim=0:7,setpts=PTS-STARTPTS[tilt];\
[up][tilt]concat=n=2:v=1[v]" -map "[v]" -pix_fmt yuv420p "$out"
ls -la "$out"
