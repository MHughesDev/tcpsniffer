/**
 * TCP Sniffer — N-API addon (Stream A).
 * Exposes start(config) and stop() to TypeScript.
 * On Linux: uses CaptureEngine. On other OS: stub returns error.
 */

#include <napi.h>
#include <string>
#include <unordered_map>
#include <vector>

#ifndef TCP_SNIFFER_STUB_ONLY
#include "capture.hpp"
#include "reassembly.hpp"
#include "http_parser.hpp"
#endif

namespace {

#ifdef TCP_SNIFFER_STUB_ONLY

bool g_running = false;
std::string g_error_code;
std::string g_error_message;

#else

tcp_sniffer::CaptureEngine* g_engine = nullptr;
tcp_sniffer::Reassembler* g_reassembler = nullptr;
std::unordered_map<std::string, tcp_sniffer::HttpStreamParser*> g_http_parsers;
Napi::ThreadSafeFunction* g_message_tsf = nullptr;

#endif

// Helpers to read config from N-API object
bool get_string(Napi::Env env, const Napi::Object& obj, const char* key, std::string* out) {
  if (!obj.Has(key)) return false;
  Napi::Value v = obj.Get(key);
  if (!v.IsString()) return false;
  *out = v.As<Napi::String>().Utf8Value();
  return true;
}

bool get_number(Napi::Env env, const Napi::Object& obj, const char* key, double* out) {
  if (!obj.Has(key)) return false;
  Napi::Value v = obj.Get(key);
  if (!v.IsNumber()) return false;
  *out = v.As<Napi::Number>().DoubleValue();
  return true;
}

bool get_uint32(Napi::Env env, const Napi::Object& obj, const char* key, uint32_t* out) {
  double d;
  if (!get_number(env, obj, key, &d)) return false;
  *out = static_cast<uint32_t>(d);
  return true;
}

bool get_ports(Napi::Env env, const Napi::Object& obj, std::vector<uint16_t>* out) {
  if (!obj.Has("ports") || !obj.Get("ports").IsArray()) return false;
  Napi::Array arr = obj.Get("ports").As<Napi::Array>();
  out->clear();
  for (size_t i = 0; i < arr.Length(); i++) {
    Napi::Value v = arr[i];
    if (!v.IsNumber()) return false;
    out->push_back(static_cast<uint16_t>(v.As<Napi::Number>().Uint32Value()));
  }
  return !out->empty();
}

#ifndef TCP_SNIFFER_STUB_ONLY
struct MessagePayload {
  std::string receiver_ip;
  uint16_t receiver_port{0};
  std::string dest_ip;
  uint16_t dest_port{0};
  bool is_request{true};
  std::string method;
  std::string path;
  int status_code{0};
  std::unordered_map<std::string, std::string> headers;
  std::string body;
  bool body_truncated{false};
  std::string body_encoding;
  std::string timestamp;
};

void message_tsf_callback(Napi::Env env, Napi::Function js_callback, MessagePayload* payload) {
  if (!payload || js_callback.IsEmpty()) return;
  Napi::Object msg = Napi::Object::New(env);
  Napi::Object receiver = Napi::Object::New(env);
  receiver.Set("ip", payload->receiver_ip);
  receiver.Set("port", static_cast<uint32_t>(payload->receiver_port));
  msg.Set("receiver", receiver);
  Napi::Object destination = Napi::Object::New(env);
  destination.Set("ip", payload->dest_ip);
  destination.Set("port", static_cast<uint32_t>(payload->dest_port));
  msg.Set("destination", destination);
  msg.Set("direction", Napi::String::New(env, payload->is_request ? "request" : "response"));
  if (!payload->method.empty()) msg.Set("method", payload->method);
  if (!payload->path.empty()) msg.Set("path", payload->path);
  if (payload->status_code != 0) msg.Set("statusCode", static_cast<int32_t>(payload->status_code));
  Napi::Object headers = Napi::Object::New(env);
  for (const auto& [k, v] : payload->headers) headers.Set(k, v);
  msg.Set("headers", headers);
  msg.Set("timestamp", payload->timestamp);
  if (!payload->body.empty()) msg.Set("body", payload->body);
  if (payload->body_truncated) msg.Set("bodyTruncated", true);
  if (!payload->body_encoding.empty()) msg.Set("bodyEncoding", payload->body_encoding);
  js_callback.Call({msg});
  delete payload;
}
#endif

}  // namespace

namespace addon {

Napi::Value Start(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) {
    Napi::TypeError::New(env, "Start(config) requires a config object").ThrowAsJavaScriptException();
    return env.Null();
  }

#ifdef TCP_SNIFFER_STUB_ONLY
  g_error_code = "CAPTURE_OPEN_FAILED";
  g_error_message = "C++ engine requires Linux; build and run in a Linux container.";
  return Napi::Boolean::New(env, false);
#else
  Napi::Object config = info[0].As<Napi::Object>();

  tcp_sniffer::CaptureConfig cfg;
  get_string(env, config, "interface", &cfg.interface_name);
  if (!get_ports(env, config, &cfg.ports)) {
    Napi::TypeError::New(env, "config.ports (non-empty array) is required").ThrowAsJavaScriptException();
    return env.Null();
  }
  double sr = 1.0;
  if (get_number(env, config, "sampleRate", &sr)) cfg.sample_rate = sr;
  uint32_t mbs = 1048576;
  if (get_uint32(env, config, "maxBodySize", &mbs)) cfg.max_body_size = mbs;
  uint32_t mcc = 10000;
  if (get_uint32(env, config, "maxConcurrentConnections", &mcc)) cfg.max_concurrent_connections = mcc;
  uint32_t cit = 300000;
  if (get_uint32(env, config, "connectionIdleTimeoutMs", &cit)) cfg.connection_idle_timeout_ms = cit;

  if (g_engine == nullptr) g_engine = new tcp_sniffer::CaptureEngine();

  tcp_sniffer::ReassemblyConfig rcfg;
  rcfg.capture_ports = cfg.ports;
  rcfg.max_concurrent_connections = cfg.max_concurrent_connections;
  rcfg.connection_idle_timeout_ms = cfg.connection_idle_timeout_ms;
  if (g_message_tsf != nullptr) {
    g_message_tsf->Release();
    delete g_message_tsf;
    g_message_tsf = nullptr;
  }
  if (info.Length() >= 2 && info[1].IsFunction()) {
    g_message_tsf = new Napi::ThreadSafeFunction(
        Napi::ThreadSafeFunction::New(env, info[1].As<Napi::Function>(), "onMessage", 0, 1));
  }

  if (g_reassembler != nullptr) {
    for (auto& p : g_http_parsers) delete p.second;
    g_http_parsers.clear();
    delete g_reassembler;
  }
  g_reassembler = new tcp_sniffer::Reassembler(rcfg);
  size_t max_conn = rcfg.max_concurrent_connections;
  size_t max_body = cfg.max_body_size;
  g_reassembler->set_stream_chunk_callback([max_body](const tcp_sniffer::StreamChunk& chunk) {
    std::string key = chunk.connection_id + (chunk.client_to_server ? ":req" : ":res");
    auto it = g_http_parsers.find(key);
    if (it == g_http_parsers.end()) {
      tcp_sniffer::HttpStreamParser* p = new tcp_sniffer::HttpStreamParser(max_body);
      p->set_connection_metadata(chunk.receiver_ip, chunk.receiver_port, chunk.dest_ip, chunk.dest_port);
      p->set_message_callback([](const tcp_sniffer::HttpMessageData& m) {
        if (g_message_tsf == nullptr) return;
        MessagePayload* payload = new MessagePayload;
        payload->receiver_ip = m.receiver_ip;
        payload->receiver_port = m.receiver_port;
        payload->dest_ip = m.dest_ip;
        payload->dest_port = m.dest_port;
        payload->is_request = m.is_request;
        payload->method = m.method;
        payload->path = m.path;
        payload->status_code = m.status_code;
        payload->headers = m.headers;
        payload->body = m.body;
        payload->body_truncated = m.body_truncated;
        payload->body_encoding = m.body_encoding;
        payload->timestamp = m.timestamp;
        g_message_tsf->BlockingCall(payload, message_tsf_callback);
      });
      g_http_parsers[key] = p;
      it = g_http_parsers.find(key);
    }
    if (!chunk.data.empty())
      it->second->feed(chunk.data.data(), chunk.data.size());
  });
  tcp_sniffer::SegmentCallback on_seg = [max_conn](const tcp_sniffer::TcpSegment& seg) {
    if (g_reassembler == nullptr) return;
    g_reassembler->push_segment(seg);
    if (g_reassembler->connection_count() > max_conn / 2) {
      g_reassembler->evict_idle(g_reassembler->now_ms());
    }
  };
  bool ok = g_engine->start(cfg, on_seg, [](const std::string&, const std::string&) {});
  if (!ok) {
    Napi::Error::New(env, g_engine->last_error_message()).ThrowAsJavaScriptException();
    return env.Null();
  }
  return Napi::Boolean::New(env, true);
#endif
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
#ifdef TCP_SNIFFER_STUB_ONLY
  g_running = false;
  return env.Undefined();
#else
  Napi::Object result = Napi::Object::New(env);
  if (g_engine != nullptr) {
    g_engine->stop();
    if (g_engine->has_last_stats()) {
      result.Set("packetsReceived", Napi::Number::New(env, static_cast<double>(g_engine->last_ps_recv())));
      result.Set("packetsDropped", Napi::Number::New(env, static_cast<double>(g_engine->last_ps_drop())));
      result.Set("packetsIfDropped", Napi::Number::New(env, static_cast<double>(g_engine->last_ps_ifdrop())));
    }
  }
  if (g_reassembler != nullptr) {
    delete g_reassembler;
    g_reassembler = nullptr;
  }
  for (auto& p : g_http_parsers) delete p.second;
  g_http_parsers.clear();
  if (g_message_tsf != nullptr) {
    g_message_tsf->Release();
    delete g_message_tsf;
    g_message_tsf = nullptr;
  }
  return result;
#endif
}

Napi::Value IsRunning(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
#ifdef TCP_SNIFFER_STUB_ONLY
  return Napi::Boolean::New(env, g_running);
#else
  return Napi::Boolean::New(env, g_engine != nullptr && g_engine->is_running());
#endif
}

Napi::Value GetLastError(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object o = Napi::Object::New(env);
#ifdef TCP_SNIFFER_STUB_ONLY
  o.Set("code", g_error_code);
  o.Set("message", g_error_message);
#else
  if (g_engine != nullptr) {
    o.Set("code", g_engine->last_error_code());
    o.Set("message", g_engine->last_error_message());
  }
#endif
  return o;
}

}  // namespace addon

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("start", Napi::Function::New(env, addon::Start));
  exports.Set("stop", Napi::Function::New(env, addon::Stop));
  exports.Set("isRunning", Napi::Function::New(env, addon::IsRunning));
  exports.Set("getLastError", Napi::Function::New(env, addon::GetLastError));
  return exports;
}

NODE_API_MODULE(tcp_sniffer_native, Init)
