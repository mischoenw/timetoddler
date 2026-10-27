#pragma once

namespace power {

/** Switches the board rails on and prepares the backlight PWM (off until set_backlight). */
void init();

/** Backlight in percent (0..100). */
void set_backlight(int percent);

}  // namespace power
