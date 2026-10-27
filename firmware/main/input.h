// Rotary encoder (PCNT, quadrature), push switch and display tap.
#pragma once

#include <cstdint>

namespace input {

enum class Kind : uint8_t { Rotate, Short, Long, Double, Tap };

struct Event {
    Kind kind;
    int count;  // raw PCNT steps for Rotate
};

/** Starts the input task; events are posted to the returned queue (QueueHandle_t). */
void *start();

}  // namespace input
