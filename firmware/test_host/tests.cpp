#include <cstdio>
#include <cstring>
#include <string>

#include "button.h"
#include "protocol.h"

static int failures = 0;
#define CHECK(cond)                                                       \
    do {                                                                  \
        if (!(cond)) {                                                    \
            std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);  \
            ++failures;                                                   \
        }                                                                 \
    } while (0)

static bool parse(const std::string &s, proto::HostMsg &m) { return proto::parse_host_line(s.data(), s.size(), m); }

static void test_parse_state() {
    proto::HostMsg m;
    CHECK(parse(R"({"t":"state","mode":"running","name":"Prüfung \"A\"","client":"WEB","color":"#3cb44b","elapsed":125,"day":3600,"idx":0,"count":5})", m));
    CHECK(m.kind == proto::Kind::State);
    CHECK(m.state.mode == proto::Mode::Running);
    CHECK(std::string(m.state.name) == "Prüfung \"A\"");
    CHECK(std::string(m.state.client) == "WEB");
    CHECK(m.state.color == 0x3cb44b);
    CHECK(m.state.elapsed == 125 && m.state.day == 3600 && m.state.count == 5);

    CHECK(parse(R"({"t":"state","mode":"select","name":"Ärger 😀","color":"#FFFFFF","idx":2,"count":3,"elapsed":0,"day":0,"client":""})", m));
    CHECK(m.state.mode == proto::Mode::Select);
    CHECK(std::string(m.state.name) == "Ärger \xF0\x9F\x98\x80");
    CHECK(m.state.idx == 2);
}

static void test_parse_other() {
    proto::HostMsg m;
    CHECK(parse(R"({"t":"hello?"})", m) && m.kind == proto::Kind::HelloQuery);
    CHECK(parse(R"( {"t":"cfg","brightness":250,"led":-3} )", m) && m.kind == proto::Kind::Cfg);
    CHECK(m.cfg.brightness == 100 && m.cfg.led == 0);
    CHECK(!parse(R"({"t":"state","name":"x"})", m));  // mode missing
    CHECK(!parse(R"({"t":"nope"})", m));
    CHECK(!parse(R"({"t":"state","mode":"idle","x":{"nested":1}})", m));
    CHECK(!parse(R"({"t":"hello?")", m));
    CHECK(!parse("garbage", m));
    CHECK(!parse(std::string(600, ' '), m));
    // unknown fields are ignored
    CHECK(parse(R"({"t":"state","mode":"idle","future":[1],"x":1})", m) == false);
    CHECK(parse(R"({"t":"state","mode":"idle","future":true,"x":1.5e3})", m));
}

static void test_utf8_clip() {
    char buf[6];
    proto::copy_utf8(buf, sizeof(buf), "abcdä", 6);  // 'ä' is 2 bytes and does not fit after "abcd"
    CHECK(std::string(buf) == "abcd");
    proto::copy_utf8(buf, sizeof(buf), "abä", 4);
    CHECK(std::string(buf) == "abä");
}

static void test_format() {
    char buf[128];
    CHECK(proto::fmt_rot(buf, sizeof(buf), -4) && std::string(buf) == "{\"t\":\"rot\",\"c\":-4}\n");
    CHECK(proto::fmt_btn(buf, sizeof(buf), "long") && std::string(buf) == "{\"t\":\"btn\",\"k\":\"long\"}\n");
    CHECK(proto::fmt_tap(buf, sizeof(buf)) == 12);
    CHECK(proto::fmt_hello(buf, sizeof(buf), "1.0.0", "A1B2") &&
          std::string(buf) == "{\"t\":\"hello\",\"proto\":1,\"fw\":\"1.0.0\",\"serial\":\"A1B2\"}\n");
    CHECK(proto::fmt_rot(buf, 5, 1) == 0);
}

// Feeds a pressed/released pattern in 5 ms steps; returns the events seen.
static std::string run(const std::string &pattern) {
    button::Clicks c;
    std::string out;
    uint32_t t = 0;
    for (char ch : pattern) {
        for (int i = 0; i < 10; ++i, t += 5) {  // each char = 50 ms
            switch (c.update(ch == '#', t)) {
                case button::Event::Short: out += 'S'; break;
                case button::Event::Long: out += 'L'; break;
                case button::Event::Double: out += 'D'; break;
                default: break;
            }
        }
    }
    return out;
}

static void test_clicks() {
    CHECK(run("##........") == "S");         // short press, reported after the double-click window
    CHECK(run("##.....") == "");              // window not over yet (250 ms)
    CHECK(run("##############......") == "L");  // 700 ms held
    CHECK(run("##..##......") == "D");        // second press within 300 ms
    CHECK(run("##.......##.......") == "SS"); // two separate short presses
    CHECK(run("##..##############..") == "D"); // holding the second press does not add a long
}

static void test_debounce() {
    button::Debouncer d;
    CHECK(!d.update(true, 0));
    CHECK(!d.update(false, 5));   // bounce
    CHECK(!d.update(true, 10));
    CHECK(!d.update(true, 25));
    CHECK(d.update(true, 30));    // stable for 20 ms
    CHECK(d.update(false, 35));
    CHECK(!d.update(false, 55));
}

int main() {
    test_parse_state();
    test_parse_other();
    test_utf8_clip();
    test_format();
    test_clicks();
    test_debounce();
    if (failures) {
        std::printf("%d check(s) failed\n", failures);
        return 1;
    }
    std::printf("all firmware host tests passed\n");
    return 0;
}
