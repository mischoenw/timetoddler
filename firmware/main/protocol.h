// Line protocol between knob and app (docs/specs, "Protokoll"). No ESP-IDF dependencies: host-testable.
#pragma once

#include <cstddef>
#include <cstdint>

namespace proto {

constexpr int kVersion = 1;
constexpr size_t kMaxLine = 512;

enum class Mode : uint8_t { Absent, Idle, Running, Break, Select };

struct State {
    Mode mode = Mode::Absent;
    char name[160] = {};   // UTF-8, already clipped by the app
    char client[112] = {};
    uint32_t color = 0x888888;
    uint32_t elapsed = 0;  // seconds, the device keeps counting
    uint32_t day = 0;      // net work seconds today
    uint16_t idx = 0;
    uint16_t count = 0;
};

struct Cfg {
    int brightness = 80;  // percent
    int led = 60;         // percent
};

enum class Kind : uint8_t { None, HelloQuery, State, Cfg };

struct HostMsg {
    Kind kind = Kind::None;
    State state;
    Cfg cfg;
};

/** Parses one line from the app. Unknown types and malformed lines return false. */
bool parse_host_line(const char *line, size_t len, HostMsg &out);

// Device -> app. Each returns the number of bytes written (including the trailing '\n'), 0 if it does not fit.
size_t fmt_hello(char *buf, size_t n, const char *fw, const char *serial);
size_t fmt_rot(char *buf, size_t n, int count);
size_t fmt_btn(char *buf, size_t n, const char *kind);
size_t fmt_tap(char *buf, size_t n);

/** Copies UTF-8 into dst (NUL-terminated) without splitting a multibyte sequence. */
void copy_utf8(char *dst, size_t dst_size, const char *src, size_t src_len);

}  // namespace proto
