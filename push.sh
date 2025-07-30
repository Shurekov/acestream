#!/bin/bash

LOGDIR=/home/seva/acestream/logs
mkdir -p "$LOGDIR"

# Канал 1
nohup ffmpeg -hide_banner -loglevel info \
  -re -i "http://127.0.0.1:6878/ace/getstream?id=e38b33c56332de27ff25df223cdf488b1ec6051f" \
  -c:v copy -c:a aac -b:a 128k -f flv rtmp://127.0.0.1:1935/stream/ch1 \
  > "$LOGDIR/ch1.log" 2>&1 &

# Канал 2
nohup ffmpeg -hide_banner -loglevel info \
  -re -i "http://127.0.0.1:6880/ace/getstream?id=d5b2c6b940cf3df5e8f9dc6f000f0ea23a10b151" \
  -c:v copy -c:a aac -b:a 128k -f flv rtmp://127.0.0.1:1935/stream/ch2 \
  > "$LOGDIR/ch2.log" 2>&1 &

echo "Запущены ch1 и ch2. Логи в $LOGDIR"