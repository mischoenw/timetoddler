// Push button: debouncing and short / long / double-click detection. No ESP-IDF dependencies: host-testable.
#pragma once

#include <cstdint>

namespace button {

constexpr uint32_t kDebounceMs = 20;
constexpr uint32_t kLongMs = 600;
/** A second press within this time after release is a double click; a short press is reported after it. */
constexpr uint32_t kDoubleMs = 300;

enum class Event : uint8_t { None, Short, Long, Double };

/** Accepts a level only after it was stable for kDebounceMs. */
class Debouncer {
public:
    bool update(bool raw, uint32_t now_ms);

private:
    bool stable_ = false;
    bool last_raw_ = false;
    uint32_t since_ = 0;
};

/**
 * Feed the debounced level periodically (every few ms).
 * Long fires while still held, as soon as the threshold is reached. Double fires on the second press.
 */
class Clicks {
public:
    Event update(bool pressed, uint32_t now_ms);

private:
    enum class St : uint8_t { Idle, Down, WaitSecond, WaitRelease };
    St st_ = St::Idle;
    uint32_t t_ = 0;
};

}  // namespace button
