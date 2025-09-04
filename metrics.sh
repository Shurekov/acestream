#!/bin/bash
CPU=$(top -bn1 | awk '/Cpu/ {printf "%d", 100-$8}')
RAM=$(free | awk '/Mem:/ {printf "%d", $3/$2*100}')
read RX1 TX1 < <(awk '/eth0/ {print $2" "$10}' /proc/net/dev)
sleep 1
read RX2 TX2 < <(awk '/eth0/ {print $2" "$10}' /proc/net/dev)
RX=$(( (RX2-RX1)*8/1024/1024 ))
TX=$(( (TX2-TX1)*8/1024/1024 ))
echo "{\"cpu\":$CPU,\"ram\":$RAM,\"rx\":$RX,\"tx\":$TX}"
