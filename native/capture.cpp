/**
 * TCP Sniffer — Capture implementation.
 * Linux + libpcap only.
 */

#include "capture.hpp"
#include <pcap.h>
#include <chrono>
#include <cstring>
#include <thread>

namespace tcp_sniffer {

namespace {

void packet_handler(u_char* user, const struct pcap_pkthdr* h, const u_char* bytes) {
  auto* engine = reinterpret_cast<CaptureEngine*>(user);
  (void)engine;  // used when we pass engine as user
  TcpSegment seg;
  if (decode_packet(bytes, h->caplen, seg)) {
    // Callback will be invoked from run_loop via dispatch; we need engine to get callback.
    // pcap_loop is single-threaded per handle, so we can store callback in engine and call it here.
    // We pass engine as user and need to call its segment callback. So we need a wrapper that
    // has the callback. Easiest: pass a pointer to a struct { CaptureEngine* engine } and
    // engine->on_segment(seg). But on_segment_ is private. So either make a public dispatch
    // or use a static/capture. Actually we pass (this) as user and in the handler we cast to
    // CaptureEngine* and call a public method like dispatch_segment(seg). Add that.
    CaptureEngine* eng = reinterpret_cast<CaptureEngine*>(user);
    eng->dispatch_segment(seg);
  }
}

}  // namespace

void CaptureEngine::dispatch_segment(const TcpSegment& seg) {
  if (on_segment_) on_segment_(seg);
}

CaptureEngine::CaptureEngine() = default;

CaptureEngine::~CaptureEngine() {
  stop();
}

std::string CaptureEngine::build_bpf_filter(const std::vector<uint16_t>& ports) const {
  if (ports.empty()) return "tcp";
  std::string filter = "tcp port " + std::to_string(ports[0]);
  for (size_t i = 1; i < ports.size(); ++i) {
    filter += " or tcp port " + std::to_string(ports[i]);
  }
  return filter;
}

void CaptureEngine::report_error(const std::string& code, const std::string& message) {
  last_error_code_ = code;
  last_error_message_ = message;
  if (on_error_) on_error_(code, message);
}

bool CaptureEngine::start(const CaptureConfig& config,
                          SegmentCallback on_segment,
                          ErrorCallback on_error) {
  if (running_) {
    report_error("UNRECOVERABLE", "capture already running");
    return false;
  }
  config_ = config;
  on_segment_ = std::move(on_segment);
  on_error_ = std::move(on_error);
  last_error_code_.clear();
  last_error_message_.clear();

  char errbuf[PCAP_ERRBUF_SIZE];
  std::string iface = config_.interface_name.empty() ? "any" : config_.interface_name;
  pcap_handle_ = pcap_open_live(iface.c_str(), 65535, 1, 1000, errbuf);
  if (pcap_handle_ == nullptr) {
    report_error("CAPTURE_OPEN_FAILED", std::string("pcap_open_live: ") + errbuf);
    return false;
  }

  if (pcap_set_datalink(pcap_handle_, DLT_EN10MB) != 0) {
    pcap_close(pcap_handle_);
    pcap_handle_ = nullptr;
    report_error("CAPTURE_OPEN_FAILED", "pcap_set_datalink(EN10MB) failed");
    return false;
  }

  std::string filter_str = build_bpf_filter(config_.ports);
  bpf_program_ = new bpf_program{};
  if (pcap_compile(pcap_handle_, bpf_program_, filter_str.c_str(), 1, PCAP_NETMASK_UNKNOWN) != 0) {
    report_error("CAPTURE_OPEN_FAILED", std::string("pcap_compile: ") + pcap_geterr(pcap_handle_));
    pcap_close(pcap_handle_);
    pcap_handle_ = nullptr;
    delete bpf_program_;
    bpf_program_ = nullptr;
    return false;
  }
  if (pcap_setfilter(pcap_handle_, bpf_program_) != 0) {
    report_error("CAPTURE_OPEN_FAILED", std::string("pcap_setfilter: ") + pcap_geterr(pcap_handle_));
    pcap_freecode(bpf_program_);
    delete bpf_program_;
    pcap_close(pcap_handle_);
    pcap_handle_ = nullptr;
    bpf_program_ = nullptr;
    return false;
  }

  // A5: startup log (structured: interface, ports)
  fprintf(stderr, "{\"timestamp\":\"startup\",\"level\":\"info\",\"message\":\"capture started\",\"interface\":\"%s\",\"ports\":[",
          iface.c_str());
  for (size_t i = 0; i < config_.ports.size(); i++) {
    fprintf(stderr, "%u", static_cast<unsigned>(config_.ports[i]));
    if (i + 1 < config_.ports.size()) fprintf(stderr, ",");
  }
  fprintf(stderr, "]}\n");

  running_ = true;
  stop_requested_ = false;
  capture_thread_ = std::thread(&CaptureEngine::run_loop, this);
  return true;
}

void CaptureEngine::stop() {
  if (!running_ && pcap_handle_ == nullptr) return;
  stop_requested_ = true;
  if (pcap_handle_ != nullptr) {
    pcap_breakloop(pcap_handle_);
  }
  if (capture_thread_.joinable()) {
    capture_thread_.join();
  }
  running_ = false;
  if (pcap_handle_ != nullptr) {
    struct pcap_stat ps;
    if (pcap_stats(pcap_handle_, &ps) == 0) {
      last_ps_recv_ = ps.ps_recv;
      last_ps_drop_ = ps.ps_drop;
      last_ps_ifdrop_ = ps.ps_ifdrop;
      last_stats_valid_ = true;
    }
    if (bpf_program_ != nullptr) {
      pcap_freecode(bpf_program_);
      delete bpf_program_;
      bpf_program_ = nullptr;
    }
    pcap_close(pcap_handle_);
    pcap_handle_ = nullptr;
  }
}

void CaptureEngine::run_loop() {
  if (pcap_handle_ == nullptr) return;
  int r = pcap_loop(pcap_handle_, -1, packet_handler, reinterpret_cast<u_char*>(this));
  if (r == -1) {
    report_error("UNRECOVERABLE", std::string("pcap_loop: ") + pcap_geterr(pcap_handle_));
  }
  running_ = false;
}

}  // namespace tcp_sniffer
