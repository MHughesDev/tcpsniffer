/**
 * TCP Sniffer — Packet decoding (A1).
 * Decode Ethernet / IP / TCP from libpcap payload.
 * See docs/specs/CPP_ENGINE.md and docs/specs/TS_CPP_CONTRACT.md.
 */

#ifndef TCP_SNIFFER_PACKET_HPP
#define TCP_SNIFFER_PACKET_HPP

#include <cstdint>
#include <string>
#include <vector>

namespace tcp_sniffer {

/** Decoded 4-tuple: source and destination IP + port. */
struct FourTuple {
  std::string src_ip;
  uint16_t src_port{0};
  std::string dst_ip;
  uint16_t dst_port{0};
};

/** Decoded TCP segment for reassembly: sequence, payload, flags. */
struct TcpSegment {
  FourTuple tuple;
  uint32_t seq{0};
  uint32_t ack{0};
  bool syn{false};
  bool fin{false};
  bool rst{false};
  std::vector<uint8_t> payload;
};

/**
 * Decode packet from link-layer payload.
 * Returns true if the packet is TCP and was decoded; false otherwise.
 * segment is only valid when true.
 */
bool decode_packet(const uint8_t* data, size_t len, TcpSegment& segment);

/** Format IP:port for logging. */
std::string format_endpoint(const std::string& ip, uint16_t port);

}  // namespace tcp_sniffer

#endif  // TCP_SNIFFER_PACKET_HPP
