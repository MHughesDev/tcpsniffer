/**
 * TCP Sniffer — Connection tracking and reassembly (A2).
 * 4-tuple keying, receiver/destination from ports, ordered streams, eviction.
 * See docs/specs/CPP_ENGINE.md.
 */

#ifndef TCP_SNIFFER_REASSEMBLY_HPP
#define TCP_SNIFFER_REASSEMBLY_HPP

#include "packet.hpp"
#include <cstdint>
#include <functional>
#include <string>
#include <unordered_map>
#include <vector>

namespace tcp_sniffer {

/** Canonical connection key: "ip1:port1-ip2:port2" with smaller endpoint first. */
std::string connection_key(const std::string& src_ip, uint16_t src_port,
                           const std::string& dst_ip, uint16_t dst_port);

/** Ordered chunk of stream data for one direction. */
struct StreamChunk {
  std::string connection_id;  // same as map key
  std::string receiver_ip;
  uint16_t receiver_port{0};
  std::string dest_ip;
  uint16_t dest_port{0};
  bool client_to_server{true};  // true = client→server, false = server→client
  std::vector<uint8_t> data;
};

/** Callback for each contiguous ordered chunk (to be parsed as HTTP in A3). */
using StreamChunkCallback = std::function<void(const StreamChunk&)>;

/** Config for reassembly (from CaptureConfig). */
struct ReassemblyConfig {
  std::vector<uint16_t> capture_ports;
  size_t max_concurrent_connections{10000};
  uint64_t connection_idle_timeout_ms{300000};
};

/**
 * Reassembles TCP segments per connection, produces ordered byte streams per direction.
 * Enforces connection cap and idle timeout; logs evictions and gaps.
 */
class Reassembler {
 public:
  explicit Reassembler(ReassemblyConfig config);
  void set_stream_chunk_callback(StreamChunkCallback cb) { on_chunk_ = std::move(cb); }

  /** Process one decoded segment (called from capture thread). */
  void push_segment(const TcpSegment& seg);

  /** Evict idle connections (call periodically or from capture loop). */
  void evict_idle(uint64_t now_ms);

  /** Number of currently tracked connections. */
  size_t connection_count() const;

  /** Current time in ms (for evict_idle). */
  uint64_t now_ms() const;

 private:
  struct StreamState {
    uint32_t next_seq{0};       // next expected sequence number (after last delivered)
    bool initial_seq_set{false};
    std::vector<uint8_t> pending;  // unordered pending; we merge and deliver in order
    // Simple approach: store (seq, data) segments, then deliver in order
    std::vector<std::pair<uint32_t, std::vector<uint8_t>>> segments;
  };

  struct ConnectionState {
    std::string receiver_ip;
    uint16_t receiver_port{0};
    std::string dest_ip;
    uint16_t dest_port{0};
    StreamState client_to_server;
    StreamState server_to_client;
    uint64_t last_activity_ms{0};
    uint64_t created_at_ms{0};  // for LRU eviction
  };

  void ensure_connection_cap(uint64_t now_ms);
  void process_segment(const std::string& key, ConnectionState& conn,
                       const TcpSegment& seg, bool is_client_to_server);
  void deliver_ordered(ConnectionState& conn, StreamState& stream,
                       const std::string& key, bool client_to_server,
                       uint32_t seq, const uint8_t* data, size_t len);
  void log_eviction(const std::string& key);
  void log_gap(const std::string& key, bool client_to_server);

  ReassemblyConfig config_;
  StreamChunkCallback on_chunk_;
  std::unordered_map<std::string, ConnectionState> connections_;
  uint64_t connection_order_{0};  // for LRU
};

}  // namespace tcp_sniffer

#endif  // TCP_SNIFFER_REASSEMBLY_HPP
