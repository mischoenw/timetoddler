// LED ring: status animations (see docs/specs, "Anzeige am Gerät").
#pragma once

#include <cstdint>

#include "protocol.h"

namespace leds {

void init();

/** Thread-safe: the animation task picks this up on its next frame. */
void show(const proto::State &state, bool connected);
void set_brightness(int percent);

}  // namespace leds
