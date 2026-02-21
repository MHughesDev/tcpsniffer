/**
 * TCP Sniffer — HTTP/1.x parser implementation.
 */

#include "http_parser.hpp"
#include <chrono>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <iomanip>
#include <sstream>

namespace tcp_sniffer {

namespace {

bool is_utf8(const uint8_t* data, size_t len) {
  size_t i = 0;
  while (i < len) {
    unsigned char c = data[i];
    if (c <= 0x7f) {
      i += 1;
    } else if (c >= 0xc2 && c <= 0xdf && i + 1 < len) {
      if ((data[i + 1] & 0xc0) != 0x80) return false;
      i += 2;
    } else if (c >= 0xe0 && c <= 0xef && i + 2 < len) {
      if ((data[i + 1] & 0xc0) != 0x80 || (data[i + 2] & 0xc0) != 0x80) return false;
      i += 3;
    } else if (c >= 0xf0 && c <= 0xf4 && i + 3 < len) {
      if ((data[i + 1] & 0xc0) != 0x80 || (data[i + 2] & 0xc0) != 0x80 || (data[i + 3] & 0xc0) != 0x80) return false;
      i += 4;
    } else {
      return false;
    }
  }
  return true;
}

std::string to_lower(const std::string& s) {
  std::string r = s;
  for (char& c : r) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return r;
}

}  // namespace

HttpStreamParser::HttpStreamParser(size_t max_body_size) : max_body_size_(max_body_size) {}

void HttpStreamParser::set_connection_metadata(const std::string& receiver_ip, uint16_t receiver_port,
                                               const std::string& dest_ip, uint16_t dest_port) {
  receiver_ip_ = receiver_ip;
  receiver_port_ = receiver_port;
  dest_ip_ = dest_ip;
  dest_port_ = dest_port;
}

void HttpStreamParser::reset() {
  buffer_.clear();
  state_ = kHeaders;
  content_length_ = -1;
  body_read_ = 0;
  headers_.clear();
  body_.clear();
  body_truncated_ = false;
  body_encoding_.clear();
  chunked_consumed_ = 0;
}

std::string HttpStreamParser::iso_timestamp() const {
  auto now = std::chrono::system_clock::now();
  auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count();
  time_t s = static_cast<time_t>(ms / 1000);
  struct tm tm_buf;
#ifdef _WIN32
  gmtime_s(&tm_buf, &s);
#else
  gmtime_r(&s, &tm_buf);
#endif
  char buf[32];
  snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02d.%03ldZ",
           tm_buf.tm_year + 1900, tm_buf.tm_mon + 1, tm_buf.tm_mday,
           tm_buf.tm_hour, tm_buf.tm_min, tm_buf.tm_sec, (long)(ms % 1000));
  return std::string(buf);
}

std::string HttpStreamParser::header_value(const std::string& name) const {
  std::string lower = to_lower(name);
  auto it = headers_.find(lower);
  if (it != headers_.end()) return it->second;
  for (const auto& [k, v] : headers_) {
    if (to_lower(k) == lower) return v;
  }
  return "";
}

void HttpStreamParser::emit_message() {
  if (!on_message_) return;
  HttpMessageData msg;
  msg.receiver_ip = receiver_ip_;
  msg.receiver_port = receiver_port_;
  msg.dest_ip = dest_ip_;
  msg.dest_port = dest_port_;
  msg.is_request = is_request_;
  msg.method = method_;
  msg.path = path_;
  msg.status_code = status_code_;
  msg.headers = headers_;
  msg.body = body_;
  msg.body_truncated = body_truncated_;
  msg.body_encoding = body_encoding_;
  msg.timestamp = iso_timestamp();
  on_message_(msg);
}

void HttpStreamParser::feed(const uint8_t* data, size_t len) {
  if (data == nullptr || len == 0) return;
  buffer_.insert(buffer_.end(), data, data + len);
  parse();
}

void HttpStreamParser::parse() {
  for (;;) {
    if (state_ == kHeaders) {
      if (!try_parse_headers()) break;
    } else if (state_ == kBodyContentLength) {
      parse_body_content_length(content_length_);
      if (state_ != kDone) break;
    } else if (state_ == kBodyChunked) {
      parse_body_chunked();
      if (state_ != kDone) break;
    } else {
      break;
    }
  }
}

bool HttpStreamParser::try_parse_headers() {
  const uint8_t* base = buffer_.data();
  size_t n = buffer_.size();
  const uint8_t* double_end = nullptr;
  for (size_t i = 0; i + 1 < n; i++) {
    if (base[i] == '\r' && base[i + 1] == '\n' && i + 3 < n && base[i + 2] == '\r' && base[i + 3] == '\n') {
      double_end = base + i;
      break;
    }
    if (base[i] == '\n' && i + 1 < n && base[i + 1] == '\n') {
      double_end = base + i;
      break;
    }
  }
  if (double_end == nullptr) return false;
  size_t header_len = double_end - base;
  if (base[header_len] == '\r') header_len += 4;
  else header_len += 2;

  std::string block(reinterpret_cast<const char*>(base), header_len);
  buffer_.erase(buffer_.begin(), buffer_.begin() + header_len);

  size_t pos = 0;
  size_t line_start = 0;
  bool first = true;
  while (pos <= block.size()) {
    if (pos == block.size() || block[pos] == '\n') {
      std::string line = block.substr(line_start, pos - line_start);
      while (!line.empty() && (line.back() == '\r' || line.back() == '\n')) line.pop_back();
      if (line.empty()) break;
      if (first) {
        first = false;
        if (line.size() >= 5 && line.substr(0, 5) == "HTTP/") {
          is_request_ = false;
          size_t code_start = line.find(' ', 5);
          if (code_start != std::string::npos) {
            try {
              status_code_ = std::stoi(line.substr(code_start + 1));
            } catch (...) {}
            size_t phrase_start = line.find(' ', code_start + 1);
            if (phrase_start != std::string::npos)
              status_phrase_ = line.substr(phrase_start + 1);
          }
        } else {
          is_request_ = true;
          size_t sp1 = line.find(' ');
          if (sp1 != std::string::npos) {
            method_ = line.substr(0, sp1);
            size_t sp2 = line.find(' ', sp1 + 1);
            if (sp2 != std::string::npos)
              path_ = line.substr(sp1 + 1, sp2 - (sp1 + 1));
            else
              path_ = line.substr(sp1 + 1);
          }
        }
      } else {
        size_t colon = line.find(':');
        if (colon != std::string::npos) {
          std::string key = line.substr(0, colon);
          size_t val_start = colon + 1;
          while (val_start < line.size() && (line[val_start] == ' ' || line[val_start] == '\t')) val_start++;
          std::string val = (val_start < line.size()) ? line.substr(val_start) : "";
          headers_[to_lower(key)] = val;
        }
      }
      line_start = pos + 1;
    }
    pos++;
  }

  std::string te = header_value("transfer-encoding");
  if (to_lower(te).find("chunked") != std::string::npos) {
    state_ = kBodyChunked;
    chunked_consumed_ = 0;
  } else {
    content_length_ = 0;
    std::string cl = header_value("content-length");
    if (!cl.empty()) {
      try {
        content_length_ = std::stoi(cl);
      } catch (...) {}
    }
    state_ = kBodyContentLength;
    body_read_ = 0;
  }
  return true;
}

void HttpStreamParser::parse_body_content_length(int content_length) {
  size_t need = static_cast<size_t>(content_length) - body_read_;
  if (need == 0) {
    emit_message();
    method_.clear();
    path_.clear();
    status_code_ = 0;
    headers_.clear();
    body_.clear();
    body_truncated_ = false;
    body_encoding_.clear();
    state_ = kHeaders;
    return;
  }
  if (buffer_.size() < need) return;
  size_t to_take = need;
  if (body_read_ + to_take > max_body_size_) {
    to_take = (body_read_ >= max_body_size_) ? 0 : (max_body_size_ - body_read_);
    body_truncated_ = true;
  }
  if (to_take > 0) {
    const uint8_t* start = buffer_.data();
    if (is_utf8(start, to_take)) {
      body_.append(reinterpret_cast<const char*>(start), to_take);
    } else {
      body_encoding_ = "binary";
    }
    body_read_ += to_take;
    buffer_.erase(buffer_.begin(), buffer_.begin() + (to_take < need ? to_take : need));
  } else {
    buffer_.erase(buffer_.begin(), buffer_.begin() + need);
    body_read_ += need;
  }
  if (body_read_ >= static_cast<size_t>(content_length)) {
    emit_message();
    method_.clear();
    path_.clear();
    status_code_ = 0;
    headers_.clear();
    body_.clear();
    body_truncated_ = false;
    body_encoding_.clear();
    state_ = kHeaders;
  }
}

bool HttpStreamParser::parse_chunk_size(size_t& out_size, size_t& consumed) {
  const uint8_t* p = buffer_.data();
  size_t n = buffer_.size();
  const uint8_t* end = std::find(p, p + n, '\n');
  if (end == p + n) return false;
  std::string line(reinterpret_cast<const char*>(p), end - p);
  while (!line.empty() && (line.back() == '\r' || line.back() == '\n')) line.pop_back();
  size_t hex_end = 0;
  while (hex_end < line.size() && std::isxdigit(static_cast<unsigned char>(line[hex_end]))) hex_end++;
  if (hex_end == 0) { consumed = (end - p) + 1; out_size = 0; return true; }
  out_size = static_cast<size_t>(std::stoul(line.substr(0, hex_end), nullptr, 16));
  consumed = (end - p) + 1;
  return true;
}

void HttpStreamParser::parse_body_chunked() {
  for (;;) {
    size_t chunk_size = 0, consumed = 0;
    if (!parse_chunk_size(chunk_size, consumed)) return;
    buffer_.erase(buffer_.begin(), buffer_.begin() + consumed);
    chunked_consumed_ += consumed;
    if (chunk_size == 0) {
      emit_message();
      method_.clear();
      path_.clear();
      status_code_ = 0;
      headers_.clear();
      body_.clear();
      body_truncated_ = false;
      body_encoding_.clear();
      state_ = kHeaders;
      return;
    }
    if (buffer_.size() < chunk_size + 2) return;
    size_t to_append = chunk_size;
    if (body_.size() + to_append > max_body_size_) {
      to_append = (body_.size() >= max_body_size_) ? 0 : (max_body_size_ - body_.size());
      body_truncated_ = true;
    }
    if (to_append > 0) {
      const uint8_t* start = buffer_.data();
      if (is_utf8(start, to_append)) {
        body_.append(reinterpret_cast<const char*>(start), to_append);
      } else {
        body_encoding_ = "binary";
      }
    }
    buffer_.erase(buffer_.begin(), buffer_.begin() + chunk_size + 2);
    chunked_consumed_ += chunk_size + 2;
  }
}

}  // namespace tcp_sniffer
