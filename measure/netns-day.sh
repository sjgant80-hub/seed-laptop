#!/usr/bin/env bash
# measure/netns-day.sh — claim L6 (a): the sealed day, run as a guest in a locked network namespace and watched FROM
# BELOW, on the host side of the boundary. Linux only (GitHub's runner). After airgap-prover's harness
# (sjgant80-hub/airgap-prover, harness/run-namespace.sh): the guest gets a veth pair and a default route, so anything it
# tries to send is emitted where tcpdump on the HOST side records it; the host does not forward, so nothing reaches the
# internet. The one declared peer is the owner's mail provider's stand-in (a sink on the host end of the veth).
#
#   sudo ./measure/netns-day.sh <outdir>
set -euo pipefail
OUT="${1:?usage: netns-day.sh <outdir>}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$OUT"
NS=sld; HOST_VETH=sld-host; NS_VETH=sld-ns; HOST_IP=10.9.9.1; NS_IP=10.9.9.2
# never `kill 0`: with no sink yet that signals this whole process group (the runner's own step with it)
cleanup() { ip netns del "$NS" 2>/dev/null || true; ip link del "$HOST_VETH" 2>/dev/null || true; if [ -n "${SINK_PID:-}" ]; then kill "$SINK_PID" 2>/dev/null || true; fi; }
trap cleanup EXIT
cleanup
sysctl -w net.ipv4.ip_forward=0 >/dev/null
sysctl -w net.ipv6.conf.all.forwarding=0 >/dev/null || true
ip netns add "$NS"
ip link add "$HOST_VETH" type veth peer name "$NS_VETH"
ip link set "$NS_VETH" netns "$NS"
ip addr add "$HOST_IP/24" dev "$HOST_VETH"; ip link set "$HOST_VETH" up
ip netns exec "$NS" ip addr add "$NS_IP/24" dev "$NS_VETH"
ip netns exec "$NS" ip link set "$NS_VETH" up
ip netns exec "$NS" ip link set lo up
ip netns exec "$NS" ip route add default via "$HOST_IP"
node "$REPO/tools/smtp-sink-run.mjs" "$HOST_IP" 2525 > "$OUT/sink.json" &
SINK_PID=$!
tcpdump -i "$HOST_VETH" -w "$OUT/day.pcap" -U -n '(ip or ip6)' >/dev/null 2>&1 &
TCPDUMP_PID=$!
sleep 1
mkdir -p "$OUT/home"
ip netns exec "$NS" node "$REPO/tools/day.mjs" --home "$OUT/home" --sink "$HOST_IP:2525" --out "$OUT/day.json" || true
sleep 2
kill -INT "$TCPDUMP_PID" 2>/dev/null || true
wait "$TCPDUMP_PID" 2>/dev/null || true
echo "[netns-day] captured $(stat -c%s "$OUT/day.pcap") bytes"
