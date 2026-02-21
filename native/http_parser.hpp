/**
 * TCP Sniffer — HTTP/1.x parsing (A3).
 * Request/response, headers, Content-Length and chunked body, maxBodySize.
 * See docs/specs/CPP_ENGINE.md and TS_CPP_CONTRACT.md §2.
 */

#ifndef TCP_SNIFFER_HTTP_PARSER_HPP
#define TCP_SNIFFER_HTTP_PARSER_HPP

#include <cstdint>
#include <functional>
#include <string>
#include <unordered_map>
#include <vector>

namespace tcp_sniffer {

/** Parsed HTTP message (contract shape in C++; converted to N-API in A4). */
struct HttpMessageData {
  std::string receiver_ip;
  uint16_t receiver_port{0};
  std::string dest_ip;
  uint16_t dest_port{0};
  bool is_request{true};   // true = request, false = response
  std::string method;
  std::string path;
  int status_code{0};
  std::unordered_map<std::string, std::string> headers;
  std::string body;
  bool body_truncated{false};
  std::string body_encoding;  // "binary" or empty
  std::string timestamp;     // ISO 8601 UTC
};

using HttpMessageCallback = std::function<void(const HttpMessageData&)>;

/**
 * Stateful HTTP/1.x stream parser. Feed bytes; invokes callback per complete message.
 * Handles Content-Length and Transfer-Encoding: chunked. Applies max_body_size.
 */
class HttpStreamParser {
 public:
  explicit HttpStreamParser(size_t max_body_size);
  void set_message_callback(HttpMessageCallback cb) { on_message_ = std::move(cb); }

  /** Feed more bytes (from reassembled stream). */
  void feed(const uint8_t* data, size_t len);

  /** Reset parser state for a new connection (optional). */
  void reset();

  /** Set connection metadata (receiver/dest) from StreamChunk; call before first feed. */
  void set_connection_metadata(const std::string& receiver_ip, uint16_t receiver_port,
                               const std::string& dest_ip, uint16_t dest_port);

 private:
  void parse();
  bool try_parse_headers();
  void parse_body_content_length(int content_length);
  void parse_body_chunked();
  bool parse_chunk_size(size_t& out_size, size_t& consumed);
  std::string header_value(const std::string& name) const;
  void emit_message();
  std::string iso_timestamp() const;

  size_t max_body_size_;
  HttpMessageCallback on_message_;
  std::vector<uint8_t> buffer_;
  enum { kHeaders, kBodyContentLength, kBodyChunked, kDone } state_{kHeaders};
  int content_length_{-1};
  size_t body_read_{0};
  std::string method_;
  std::string path_;
  int status_code_{0};
  std::string status_phrase_;
  std::unordered_map<std::string, std::string> headers_;
  std::string body_;
  bool body_truncated_{false};
  std::string body_encoding_;
  bool is_request_{true};
  std::string receiver_ip_;
  uint16_t receiver_port_{0};
  std::string dest_ip_;
  uint16_t dest_port_{0};
  size_t chunked_consumed_{0};
};

}  // namespace tcp_sniffer

#endif  // TCP_SNIFFER_HTTP_PARSER_HPP
