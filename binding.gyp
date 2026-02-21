{
  "targets": [
    {
      "target_name": "tcp_sniffer_native",
      "sources": ["native/addon.cpp"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "native"
      ],
      "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "conditions": [
        ["OS=='linux'", {
          "sources": ["native/capture.cpp", "native/packet.cpp", "native/reassembly.cpp", "native/http_parser.cpp"],
          "libraries": ["-lpcap"],
          "cflags_cc": ["-std=c++17"]
        }],
        ["OS!='linux'", {
          "defines": ["TCP_SNIFFER_STUB_ONLY"],
          "cflags_cc": ["-std=c++17"]
        }]
      ]
    }
  ]
}
