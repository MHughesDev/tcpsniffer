/**
 * TCP Sniffer — Packet decoding implementation.
 * Handles Ethernet II, IPv4, and TCP. No IPv6 in MVP.
 */

#include "packet.hpp"
#include <arpa/inet.h>
#include <cstring>
#include <netinet/ip.h>
#include <netinet/tcp.h>
#include <sys/types.h>

namespace tcp_sniffer {

namespace {

const size_t MIN_ETH_IP_TCP = 14 + 20 + 20;  // eth + ip + tcp min headers

/** Ethernet type for IPv4. */
const uint16_t ETH_P_IP4 = 0x0800;

std::string ip4_to_string(uint32_t addr) {
  char buf[INET_ADDRSTRLEN];
  struct in_addr a;
  a.s_addr = addr;
  return inet_ntop(AF_INET, &a, buf, sizeof(buf)) ? std::string(buf) : "";
}

}  // namespace

bool decode_packet(const uint8_t* data, size_t len, TcpSegment& segment) {
  if (data == nullptr || len < MIN_ETH_IP_TCP) return false;

  // Ethernet II: 6 dst MAC, 6 src MAC, 2 type
  uint16_t ether_type = (static_cast<uint16_t>(data[12]) << 8) | data[13];
  if (ether_type != ETH_P_IP4) return false;

  const uint8_t* ip_base = data + 14;
  size_t ip_len = len - 14;
  if (ip_len < sizeof(struct ip)) return false;

  const struct ip* ip = reinterpret_cast<const struct ip*>(ip_base);
  if (ip->ip_v != 4 || ip->ip_p != 6) return false;  // 6 = IPPROTO_TCP

  size_t ip_header_len = static_cast<size_t>(ip->ip_hl) * 4;
  if (ip_len < ip_header_len) return false;

  const uint8_t* tcp_base = ip_base + ip_header_len;
  size_t tcp_total = ip_len - ip_header_len;
  if (tcp_total < sizeof(struct tcphdr)) return false;

  const struct tcphdr* tcp = reinterpret_cast<const struct tcphdr*>(tcp_base);
  size_t tcp_header_len = static_cast<size_t>(tcp->th_off) * 4;
  if (tcp_total < tcp_header_len) return false;

  segment.src_ip = ip4_to_string(ip->ip_src.s_addr);
  segment.dst_ip = ip4_to_string(ip->ip_dst.s_addr);
  segment.src_port = ntohs(tcp->th_sport);
  segment.dst_port = ntohs(tcp->th_dport);
  segment.seq = ntohl(tcp->th_seq);
  segment.ack = ntohl(tcp->th_ack);
  segment.syn = (tcp->th_flags & TH_SYN) != 0;
  segment.fin = (tcp->th_flags & TH_FIN) != 0;
  segment.rst = (tcp->th_flags & TH_RST) != 0;

  size_t payload_len = tcp_total - tcp_header_len;
  if (payload_len > 0) {
    segment.payload.assign(tcp_base + tcp_header_len, tcp_base + tcp_total);
  } else {
    segment.payload.clear();
  }

  segment.tuple.src_ip = segment.src_ip;
  segment.tuple.src_port = segment.src_port;
  segment.tuple.dst_ip = segment.dst_ip;
  segment.tuple.dst_port = segment.dst_port;

  return true;
}

std::string format_endpoint(const std::string& ip, uint16_t port) {
  return ip + ":" + std::to_string(port);
}

}  // namespace tcp_sniffer
