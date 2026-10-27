// Round display (LVGL 9): activity, elapsed time, selection, net work time today.
#pragma once

#include <cstdint>

#include "lvgl.h"
#include "protocol.h"

namespace ui {

/** Builds the screen; call with the LVGL port lock held. */
void init(lv_display_t *disp);

/** New state from the app (or disconnected). Call with the LVGL port lock held. */
void show(const proto::State &state, bool connected, int64_t now_ms);

/** Advances the counters between updates. Call with the LVGL port lock held. */
void tick(int64_t now_ms);

}  // namespace ui
