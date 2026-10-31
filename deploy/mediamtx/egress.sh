#!/bin/sh
# RTSP can redirect; enforce the allowed destination networks in the media network namespace too.
set -eu
iptables -P OUTPUT DROP
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -d 127.0.0.11 -p udp -j ACCEPT
iptables -A OUTPUT -d 127.0.0.11 -p tcp -j ACCEPT
# Stable IP on the dedicated internal control network survives API container recreation.
api_ip=${VIDEO_CONTROL_API_IP:-172.31.250.2}
iptables -A OUTPUT -d "$api_ip" -p tcp --dport 3000 -j ACCEPT
for forbidden in 0.0.0.0/8 127.0.0.0/8 169.254.0.0/16 224.0.0.0/4 240.0.0.0/4; do
  iptables -A OUTPUT -d "$forbidden" -j REJECT
done
for network in $(printf '%s' "${VIDEO_ALLOWED_NETWORKS:-}" | tr ',' ' '); do
  for port in $(printf '%s' "${VIDEO_ALLOWED_PORTS:-554}" | tr ',' ' '); do
    iptables -A OUTPUT -d "$network" -p tcp --dport "$port" -j ACCEPT
  done
done
# IPv6 equipment is not exposed by current IPv4/DNS equipment forms.
ip6tables -P OUTPUT DROP
exec su-exec 10001:10001 /usr/local/bin/mediamtx /etc/mediamtx/mediamtx.yml
