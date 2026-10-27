#include "protocol.h"

#include <cstdio>
#include <cstring>

namespace proto {
namespace {

// Minimal parser for one flat JSON object: {"key": "string" | number | true | false | null, ...}.
// That is all the app sends; nested values make the line invalid.
class FlatJson {
public:
    FlatJson(const char *s, size_t n) : p_(s), end_(s + n) {}

    template <typename OnField>
    bool parse(OnField on_field) {
        ws();
        if (!eat('{')) return false;
        ws();
        if (eat('}')) return true;
        for (;;) {
            char key[24];
            size_t key_len = 0;
            if (!string(key, sizeof(key), key_len)) return false;
            ws();
            if (!eat(':')) return false;
            ws();
            Value v;
            if (p_ < end_ && *p_ == '"') {
                v.is_string = true;
                if (!string(v.str, sizeof(v.str), v.str_len)) return false;
            } else if (!scalar(v)) {
                return false;
            }
            on_field(key, v);
            ws();
            if (eat(',')) {
                ws();
                continue;
            }
            if (eat('}')) break;
            return false;
        }
        ws();
        return p_ == end_;
    }

    struct Value {
        bool is_string = false;
        char str[192] = {};
        size_t str_len = 0;
        bool is_number = false;
        long long num = 0;
    };

private:
    const char *p_;
    const char *end_;

    void ws() {
        while (p_ < end_ && (*p_ == ' ' || *p_ == '\t' || *p_ == '\r' || *p_ == '\n')) ++p_;
    }

    bool eat(char c) {
        if (p_ < end_ && *p_ == c) {
            ++p_;
            return true;
        }
        return false;
    }

    static int hex(char c) {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    }

    bool hex4(uint32_t &cp) {
        if (end_ - p_ < 4) return false;
        cp = 0;
        for (int i = 0; i < 4; ++i) {
            int h = hex(*p_++);
            if (h < 0) return false;
            cp = cp << 4 | uint32_t(h);
        }
        return true;
    }

    // Appends while there is room; overlong strings are cut (copy_utf8 later keeps sequences whole).
    static void put(char *out, size_t cap, size_t &len, char c) {
        if (len + 1 < cap) out[len++] = c;
    }

    static void put_utf8(char *out, size_t cap, size_t &len, uint32_t cp) {
        if (cp < 0x80) {
            put(out, cap, len, char(cp));
        } else if (cp < 0x800) {
            put(out, cap, len, char(0xC0 | cp >> 6));
            put(out, cap, len, char(0x80 | (cp & 0x3F)));
        } else if (cp < 0x10000) {
            put(out, cap, len, char(0xE0 | cp >> 12));
            put(out, cap, len, char(0x80 | (cp >> 6 & 0x3F)));
            put(out, cap, len, char(0x80 | (cp & 0x3F)));
        } else {
            put(out, cap, len, char(0xF0 | cp >> 18));
            put(out, cap, len, char(0x80 | (cp >> 12 & 0x3F)));
            put(out, cap, len, char(0x80 | (cp >> 6 & 0x3F)));
            put(out, cap, len, char(0x80 | (cp & 0x3F)));
        }
    }

    bool string(char *out, size_t cap, size_t &len) {
        len = 0;
        if (!eat('"')) return false;
        while (p_ < end_) {
            char c = *p_++;
            if (c == '"') {
                out[len] = '\0';
                return true;
            }
            if (static_cast<unsigned char>(c) < 0x20) return false;
            if (c != '\\') {
                put(out, cap, len, c);
                continue;
            }
            if (p_ >= end_) return false;
            char e = *p_++;
            switch (e) {
                case '"': case '\\': case '/': put(out, cap, len, e); break;
                case 'b': put(out, cap, len, '\b'); break;
                case 'f': put(out, cap, len, '\f'); break;
                case 'n': put(out, cap, len, '\n'); break;
                case 'r': put(out, cap, len, '\r'); break;
                case 't': put(out, cap, len, '\t'); break;
                case 'u': {
                    uint32_t cp;
                    if (!hex4(cp)) return false;
                    if (cp >= 0xD800 && cp < 0xDC00) {
                        uint32_t lo;
                        if (end_ - p_ < 6 || p_[0] != '\\' || p_[1] != 'u') return false;
                        p_ += 2;
                        if (!hex4(lo) || lo < 0xDC00 || lo > 0xDFFF) return false;
                        cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                    }
                    put_utf8(out, cap, len, cp);
                    break;
                }
                default: return false;
            }
        }
        return false;
    }

    bool literal(const char *word) {
        size_t n = strlen(word);
        if (size_t(end_ - p_) < n || memcmp(p_, word, n) != 0) return false;
        p_ += n;
        return true;
    }

    bool scalar(Value &v) {
        if (literal("true")) { v.is_number = true; v.num = 1; return true; }
        if (literal("false")) { v.is_number = true; v.num = 0; return true; }
        if (literal("null")) return true;
        bool neg = eat('-');
        if (p_ >= end_ || *p_ < '0' || *p_ > '9') return false;
        long long n = 0;
        while (p_ < end_ && *p_ >= '0' && *p_ <= '9') {
            if (n < 1000000000000LL) n = n * 10 + (*p_ - '0');
            ++p_;
        }
        // Fractions and exponents are accepted but dropped: the app only sends integers.
        if (eat('.')) while (p_ < end_ && *p_ >= '0' && *p_ <= '9') ++p_;
        if (p_ < end_ && (*p_ == 'e' || *p_ == 'E')) {
            ++p_;
            if (p_ < end_ && (*p_ == '+' || *p_ == '-')) ++p_;
            while (p_ < end_ && *p_ >= '0' && *p_ <= '9') ++p_;
        }
        v.is_number = true;
        v.num = neg ? -n : n;
        return true;
    }
};

bool parse_color(const char *s, uint32_t &out) {
    if (s[0] != '#' || strlen(s) != 7) return false;
    uint32_t c = 0;
    for (int i = 1; i < 7; ++i) {
        char ch = s[i];
        int h = (ch >= '0' && ch <= '9') ? ch - '0' : (ch >= 'a' && ch <= 'f') ? ch - 'a' + 10 : (ch >= 'A' && ch <= 'F') ? ch - 'A' + 10 : -1;
        if (h < 0) return false;
        c = c << 4 | uint32_t(h);
    }
    out = c;
    return true;
}

bool parse_mode(const char *s, Mode &m) {
    static const struct { const char *name; Mode mode; } kModes[] = {
        {"absent", Mode::Absent}, {"idle", Mode::Idle}, {"running", Mode::Running}, {"break", Mode::Break}, {"select", Mode::Select},
    };
    for (const auto &e : kModes) {
        if (strcmp(s, e.name) == 0) {
            m = e.mode;
            return true;
        }
    }
    return false;
}

uint32_t clamp_u32(long long v, uint32_t max) {
    return v < 0 ? 0 : v > max ? max : uint32_t(v);
}

size_t finish(size_t n, int written) {
    return (written > 0 && size_t(written) < n) ? size_t(written) : 0;
}

}  // namespace

void copy_utf8(char *dst, size_t dst_size, const char *src, size_t src_len) {
    if (dst_size == 0) return;
    size_t n = src_len < dst_size - 1 ? src_len : dst_size - 1;
    // Step back over continuation bytes so a cut never leaves half a character.
    if (n < src_len) {
        while (n > 0 && (static_cast<unsigned char>(src[n]) & 0xC0) == 0x80) --n;
    }
    memcpy(dst, src, n);
    dst[n] = '\0';
}

bool parse_host_line(const char *line, size_t len, HostMsg &out) {
    if (len > kMaxLine) return false;
    char type[16] = {};
    bool has_mode = false;
    HostMsg msg;
    // Defaults for cfg come from the struct; state fields missing from the line stay at their defaults.
    FlatJson json(line, len);
    bool ok = json.parse([&](const char *key, const FlatJson::Value &v) {
        if (strcmp(key, "t") == 0 && v.is_string) {
            copy_utf8(type, sizeof(type), v.str, v.str_len);
        } else if (strcmp(key, "mode") == 0 && v.is_string) {
            has_mode = parse_mode(v.str, msg.state.mode);
        } else if (strcmp(key, "name") == 0 && v.is_string) {
            copy_utf8(msg.state.name, sizeof(msg.state.name), v.str, v.str_len);
        } else if (strcmp(key, "client") == 0 && v.is_string) {
            copy_utf8(msg.state.client, sizeof(msg.state.client), v.str, v.str_len);
        } else if (strcmp(key, "color") == 0 && v.is_string) {
            parse_color(v.str, msg.state.color);
        } else if (strcmp(key, "elapsed") == 0 && v.is_number) {
            msg.state.elapsed = clamp_u32(v.num, 100u * 3600u);
        } else if (strcmp(key, "day") == 0 && v.is_number) {
            msg.state.day = clamp_u32(v.num, 48u * 3600u);
        } else if (strcmp(key, "idx") == 0 && v.is_number) {
            msg.state.idx = uint16_t(clamp_u32(v.num, 9999));
        } else if (strcmp(key, "count") == 0 && v.is_number) {
            msg.state.count = uint16_t(clamp_u32(v.num, 9999));
        } else if (strcmp(key, "brightness") == 0 && v.is_number) {
            msg.cfg.brightness = int(clamp_u32(v.num, 100));
        } else if (strcmp(key, "led") == 0 && v.is_number) {
            msg.cfg.led = int(clamp_u32(v.num, 100));
        }
    });
    if (!ok) return false;
    if (strcmp(type, "hello?") == 0) {
        msg.kind = Kind::HelloQuery;
    } else if (strcmp(type, "state") == 0 && has_mode) {
        msg.kind = Kind::State;
    } else if (strcmp(type, "cfg") == 0) {
        msg.kind = Kind::Cfg;
    } else {
        return false;
    }
    out = msg;
    return true;
}

size_t fmt_hello(char *buf, size_t n, const char *fw, const char *serial) {
    return finish(n, snprintf(buf, n, "{\"t\":\"hello\",\"proto\":%d,\"fw\":\"%s\",\"serial\":\"%s\"}\n", kVersion, fw, serial));
}

size_t fmt_rot(char *buf, size_t n, int count) {
    return finish(n, snprintf(buf, n, "{\"t\":\"rot\",\"c\":%d}\n", count));
}

size_t fmt_btn(char *buf, size_t n, const char *kind) {
    return finish(n, snprintf(buf, n, "{\"t\":\"btn\",\"k\":\"%s\"}\n", kind));
}

size_t fmt_tap(char *buf, size_t n) {
    return finish(n, snprintf(buf, n, "{\"t\":\"tap\"}\n"));
}

}  // namespace proto
