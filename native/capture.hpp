/**
 * TCP Sniffer — Capture layer (A1).
 * libpcap open, BPF filter from ports, packet loop, decode to TcpSegment.
 * See docs/specs/CPP_ENGINE.md.
 */

#ifndef TCP_SNIFFER_CAPTURE_HPP
#define TCP_SNIFFER_CAPTURE_HPP

#include "packet.hpp"
#include <functional>
#include <memory>
#include <string>
#include <thread>
#include <vector>

struct pcap;
struct bpf_program;

namespace tcp_sniffer {

/** Config passed from TS (subset used by capture). */
struct CaptureConfig {
  std::string interface_name;
  std::vector<uint16_t> ports;
  double sample_rate{1.0};
  size_t max_body_size{1024 * 1024};
  size_t max_concurrent_connections{10000};
  uint64_t connection_idle_timeout_ms{300000};
};

/** Callback for each decoded TCP segment. Called from capture thread. */
using SegmentCallback = std::function<void(const TcpSegment&)>;

/** Optional error callback (fatal). */
using ErrorCallback = std::function<void(const std::string& code, const std::string& message)>;

/**
 * Capture engine: open pcap, apply BPF, run loop, decode and invoke callback.
 * Thread: start() begins a capture thread; stop() signals stop and joins.
 */
class CaptureEngine {
 public:
  CaptureEngine();
  ~CaptureEngine();

  /** Build BPF from ports and open pcap on interface. Returns false on error. */
  bool start(const CaptureConfig& config,
             SegmentCallback on_segment,
             ErrorCallback on_error);

  /** Stop loop, drain (no-op in A1), close handle. Blocks until done. */
  void stop();

  /** Whether capture is currently running. */
  bool is_running() const { return running_; }

  /** Called from pcap callback; invokes on_segment. Do not call from TS. */
  void dispatch_segment(const TcpSegment& seg);

  /** Last fatal error message if start failed. */
  std::string last_error_code() const { return last_error_code_; }
  std::string last_error_message() const { return last_error_message_; }

  /** Capture stats from last stop() (pcap_stats). Only valid after stop() was called with a valid handle. */
  unsigned int last_ps_recv() const { return last_ps_recv_; }
  unsigned int last_ps_drop() const { return last_ps_drop_; }
  unsigned int last_ps_ifdrop() const { return last_ps_ifdrop_; }
  bool has_last_stats() const { return last_stats_valid_; }

 private:
  void run_loop();
  std::string build_bpf_filter(const std::vector<uint16_t>& ports) const;
  void report_error(const std::string& code, const std::string& message);

  pcap* pcap_handle_{nullptr};
  bpf_program* bpf_program_{nullptr};
  CaptureConfig config_;
  SegmentCallback on_segment_;
  ErrorCallback on_error_;
  bool running_{false};
  bool stop_requested_{false};
  std::thread capture_thread_;
  std::string last_error_code_;
  std::string last_error_message_;
  unsigned int last_ps_recv_{0};
  unsigned int last_ps_drop_{0};
  unsigned int last_ps_ifdrop_{0};
  bool last_stats_valid_{false};
};

}  // namespace tcp_sniffer

#endif  // TCP_SNIFFER_CAPTURE_HPP
