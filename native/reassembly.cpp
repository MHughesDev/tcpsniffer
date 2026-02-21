/**
 * TCP Sniffer — Reassembly implementation.
 */

#include "reassembly.hpp"
#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <cstdio>

namespace tcp_sniffer {

namespace {

std::string endpoint_key(const std::string& ip, uint16_t port) {
  return ip + ":" + std::to_string(port);
}

}  // namespace

std::string connection_key(const std::string& src_ip, uint16_t src_port,
                           const std::string& dst_ip, uint16_t dst_port) {
  std::string a = endpoint_key(src_ip, src_port);
  std::string b = endpoint_key(dst_ip, dst_port);
  if (a < b) return a + "-" + b;
  return b + "-" + a;
}

Reassembler::Reassembler(ReassemblyConfig config) : config_(std::move(config)) {}

uint64_t Reassembler::now_ms() const {
  return static_cast<uint64_t>(
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::steady_clock::now().time_since_epoch())
          .count());
}

void Reassembler::log_eviction(const std::string& key) {
  (void)key;
  // Structured log: eviction (once per event). Could fprintf or callback.
  fprintf(stderr, "[tcp_sniffer] eviction connection=%s\n", key.c_str());
}

void Reassembler::log_gap(const std::string& key, bool client_to_server) {
  (void)key;
  (void)client_to_server;
  fprintf(stderr, "[tcp_sniffer] reassembly_gap connection=%s direction=%s\n",
          key.c_str(), client_to_server ? "client_to_server" : "server_to_client");
}

size_t Reassembler::connection_count() const {
  return connections_.size();
}

void Reassembler::evict_idle(uint64_t now_ms) {
  std::vector<std::string> to_remove;
  for (auto& [key, conn] : connections_) {
    if (now_ms - conn.last_activity_ms >= config_.connection_idle_timeout_ms) {
      to_remove.push_back(key);
    }
  }
  for (const auto& key : to_remove) {
    log_eviction(key);
    connections_.erase(key);
  }

  ensure_connection_cap(now_ms);
}

void Reassembler::ensure_connection_cap(uint64_t now_ms) {
  while (connections_.size() > config_.max_concurrent_connections) {
    // Evict oldest by created_at_ms
    std::string oldest_key;
    uint64_t oldest = UINT64_MAX;
    for (const auto& [key, conn] : connections_) {
      if (conn.created_at_ms < oldest) {
        oldest = conn.created_at_ms;
        oldest_key = key;
      }
    }
    if (oldest_key.empty()) break;
    log_eviction(oldest_key);
    connections_.erase(oldest_key);
  }
}

void Reassembler::deliver_ordered(ConnectionState& conn, StreamState& stream,
                                   const std::string& key, bool client_to_server,
                                   uint32_t seq, const uint8_t* data, size_t len) {
  if (len == 0) return;
  if (!stream.initial_seq_set) {
    stream.next_seq = seq;
    stream.initial_seq_set = true;
  }
  // Only deliver if this segment is exactly at next_seq (no gap handling for MVP).
  if (seq == stream.next_seq) {
    stream.next_seq = seq + static_cast<uint32_t>(len);
    if (on_chunk_) {
      StreamChunk chunk;
      chunk.connection_id = key;
      chunk.receiver_ip = conn.receiver_ip;
      chunk.receiver_port = conn.receiver_port;
      chunk.dest_ip = conn.dest_ip;
      chunk.dest_port = conn.dest_port;
      chunk.client_to_server = client_to_server;
      chunk.data.assign(data, data + len);
      on_chunk_(chunk);
    }
    // After delivering, check if any buffered segments can now be delivered
    bool again = true;
    while (again) {
      again = false;
      for (auto it = stream.segments.begin(); it != stream.segments.end(); ) {
        if (it->first == stream.next_seq) {
          const auto& d = it->second;
          if (!d.empty() && on_chunk_) {
            StreamChunk chunk;
            chunk.connection_id = key;
            chunk.receiver_ip = conn.receiver_ip;
            chunk.receiver_port = conn.receiver_port;
            chunk.dest_ip = conn.dest_ip;
            chunk.dest_port = conn.dest_port;
            chunk.client_to_server = client_to_server;
            chunk.data = d;
            on_chunk_(chunk);
          }
          stream.next_seq += static_cast<uint32_t>(it->second.size());
          it = stream.segments.erase(it);
          again = true;
        } else if (it->first > stream.next_seq) {
          log_gap(key, client_to_server);
          break;  // gap
        } else {
          ++it;
        }
      }
    }
  } else if (seq > stream.next_seq) {
    // Buffer for later
    stream.segments.push_back({seq, std::vector<uint8_t>(data, data + len)});
    std::sort(stream.segments.begin(), stream.segments.end(),
              [](const auto& a, const auto& b) { return a.first < b.first; });
  }
  // else seq < next_seq: duplicate/retransmit, ignore
}

void Reassembler::process_segment(const std::string& key, ConnectionState& conn,
                                   const TcpSegment& seg, bool is_client_to_server) {
  StreamState& stream = is_client_to_server ? conn.client_to_server : conn.server_to_client;
  if (seg.payload.empty()) {
    if (seg.syn && !stream.initial_seq_set) {
      stream.initial_seq_set = true;
      stream.next_seq = seg.seq + 1;  // SYN consumes one
    }
    return;
  }
  uint32_t seq = seg.seq;
  const uint8_t* data = seg.payload.data();
  size_t len = seg.payload.size();
  deliver_ordered(conn, stream, key, is_client_to_server, seq, data, len);
}

void Reassembler::push_segment(const TcpSegment& seg) {
  uint64_t now = now_ms();
  bool receiver_is_src = false;
  for (uint16_t p : config_.capture_ports) {
    if (seg.src_port == p) { receiver_is_src = true; break; }
    if (seg.dst_port == p) break;
  }
  std::string key = connection_key(seg.src_ip, seg.src_port, seg.dst_ip, seg.dst_port);
  ConnectionState& conn = connections_[key];
  if (conn.receiver_port == 0) {
    conn.created_at_ms = now;
    conn.last_activity_ms = now;
    if (receiver_is_src) {
      conn.receiver_ip = seg.src_ip;
      conn.receiver_port = seg.src_port;
      conn.dest_ip = seg.dst_ip;
      conn.dest_port = seg.dst_port;
    } else {
      conn.receiver_ip = seg.dst_ip;
      conn.receiver_port = seg.dst_port;
      conn.dest_ip = seg.src_ip;
      conn.dest_port = seg.src_port;
    }
  }
  conn.last_activity_ms = now;

  // Packet from destination (client) toward receiver (server) = client→server (request).
  bool client_to_server = (seg.src_ip == conn.dest_ip && seg.src_port == conn.dest_port);

  process_segment(key, conn, seg, client_to_server);
  ensure_connection_cap(now);
}

}  // namespace tcp_sniffer
