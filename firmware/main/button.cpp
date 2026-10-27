#include "button.h"

namespace button {

bool Debouncer::update(bool raw, uint32_t now_ms) {
    if (raw != last_raw_) {
        last_raw_ = raw;
        since_ = now_ms;
    } else if (raw != stable_ && now_ms - since_ >= kDebounceMs) {
        stable_ = raw;
    }
    return stable_;
}

Event Clicks::update(bool pressed, uint32_t now_ms) {
    switch (st_) {
        case St::Idle:
            if (pressed) {
                st_ = St::Down;
                t_ = now_ms;
            }
            return Event::None;
        case St::Down:
            if (!pressed) {
                st_ = St::WaitSecond;
                t_ = now_ms;
                return Event::None;
            }
            if (now_ms - t_ >= kLongMs) {
                st_ = St::WaitRelease;
                return Event::Long;
            }
            return Event::None;
        case St::WaitSecond:
            if (pressed) {
                st_ = St::WaitRelease;
                return Event::Double;
            }
            if (now_ms - t_ >= kDoubleMs) {
                st_ = St::Idle;
                return Event::Short;
            }
            return Event::None;
        case St::WaitRelease:
            if (!pressed) st_ = St::Idle;
            return Event::None;
    }
    return Event::None;
}

}  // namespace button
