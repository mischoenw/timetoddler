#include "ui.h"

#include <cstdio>

#include "esp_log.h"

extern const uint8_t font_ttf_start[] asm("_binary_Montserrat_Medium_ttf_start");
extern const uint8_t font_ttf_end[] asm("_binary_Montserrat_Medium_ttf_end");

namespace ui {
namespace {

const char *TAG = "ui";
constexpr uint32_t kPauseColor = 0xF58231;
constexpr uint32_t kDimColor = 0x404040;
constexpr uint32_t kTextDim = 0x9AA0A6;

lv_obj_t *s_arc;
lv_obj_t *s_idx;
lv_obj_t *s_name;
lv_obj_t *s_client;
lv_obj_t *s_time;
lv_obj_t *s_day;

proto::State s_state;
bool s_connected = false;
int64_t s_at = 0;  // when s_state arrived

const lv_font_t *font(int px) {
    // Montserrat TTF rendered at runtime: built-in LVGL fonts have no umlauts.
    const lv_font_t *f = lv_tiny_ttf_create_data_ex(font_ttf_start, size_t(font_ttf_end - font_ttf_start), px,
                                                     LV_FONT_KERNING_NONE, 128);
    if (!f) {
        ESP_LOGE(TAG, "font %d px failed, using default", px);
        return LV_FONT_DEFAULT;
    }
    return f;
}

lv_obj_t *label(lv_obj_t *parent, const lv_font_t *f, int32_t y, uint32_t color) {
    lv_obj_t *l = lv_label_create(parent);
    lv_obj_set_style_text_font(l, f, 0);
    lv_obj_set_style_text_color(l, lv_color_hex(color), 0);
    lv_obj_set_style_text_align(l, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_align(l, LV_ALIGN_CENTER, 0, y);
    lv_label_set_text(l, "");
    return l;
}

void fmt_hms(char *buf, size_t n, uint32_t s) {
    snprintf(buf, n, "%u:%02u:%02u", unsigned(s / 3600), unsigned(s / 60 % 60), unsigned(s % 60));
}

void fmt_hm(char *buf, size_t n, uint32_t s) {
    snprintf(buf, n, "Heute %u:%02u", unsigned(s / 3600), unsigned(s / 60 % 60));
}

bool counts_elapsed(const proto::State &st) {
    return st.mode == proto::Mode::Running || st.mode == proto::Mode::Break ||
           (st.mode == proto::Mode::Select && st.elapsed > 0);
}

bool counts_day(const proto::State &st) {
    return st.mode == proto::Mode::Running || st.mode == proto::Mode::Idle || st.mode == proto::Mode::Select;
}

void render_times(int64_t now_ms) {
    const uint32_t age = s_connected ? uint32_t((now_ms - s_at) / 1000) : 0;
    char buf[32];
    if (s_connected && counts_elapsed(s_state)) {
        const uint32_t e = s_state.elapsed + age;
        fmt_hms(buf, sizeof(buf), e);
        lv_label_set_text(s_time, buf);
        if (s_state.mode == proto::Mode::Running) lv_arc_set_value(s_arc, int32_t(e % 3600 / 60));  // minute of the hour
    } else {
        lv_label_set_text(s_time, "");
    }
    if (s_connected && s_state.mode != proto::Mode::Absent) {
        fmt_hm(buf, sizeof(buf), s_state.day + (counts_day(s_state) ? age : 0));
        lv_label_set_text(s_day, buf);
    } else {
        lv_label_set_text(s_day, "");
    }
}

}  // namespace

void init(lv_display_t *disp) {
    lv_obj_t *scr = lv_display_get_screen_active(disp);
    lv_obj_set_style_bg_color(scr, lv_color_black(), 0);
    lv_obj_set_style_bg_opa(scr, LV_OPA_COVER, 0);

    s_arc = lv_arc_create(scr);
    lv_obj_set_size(s_arc, 350, 350);
    lv_obj_center(s_arc);
    lv_arc_set_rotation(s_arc, 270);
    lv_arc_set_bg_angles(s_arc, 0, 360);
    lv_arc_set_range(s_arc, 0, 60);
    lv_obj_remove_style(s_arc, nullptr, LV_PART_KNOB);
    lv_obj_remove_flag(s_arc, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_arc_width(s_arc, 14, LV_PART_MAIN);
    lv_obj_set_style_arc_width(s_arc, 14, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(s_arc, lv_color_hex(0x202020), LV_PART_MAIN);

    const lv_font_t *small = font(22);
    s_idx = label(scr, small, -105, kTextDim);
    s_name = label(scr, font(32), -40, 0xFFFFFF);
    lv_obj_set_width(s_name, 270);
    lv_label_set_long_mode(s_name, LV_LABEL_LONG_MODE_DOTS);
    lv_obj_set_height(s_name, 2 * 40);
    lv_obj_align(s_name, LV_ALIGN_CENTER, 0, -40);
    s_client = label(scr, small, 12, kTextDim);
    lv_obj_set_width(s_client, 240);
    lv_label_set_long_mode(s_client, LV_LABEL_LONG_MODE_DOTS);
    s_time = label(scr, font(56), 62, 0xFFFFFF);
    s_day = label(scr, small, 122, kTextDim);

    show(proto::State{}, false, 0);
}

void show(const proto::State &state, bool connected, int64_t now_ms) {
    s_state = state;
    s_connected = connected;
    s_at = now_ms;

    uint32_t arc_color = state.color;
    int32_t arc_value = 60;
    const char *name = state.name;
    lv_label_set_text(s_idx, "");
    lv_obj_set_style_text_color(s_name, lv_color_white(), 0);

    if (!connected) {
        name = "Nicht verbunden";
        arc_color = kDimColor;
    } else {
        switch (state.mode) {
            case proto::Mode::Running:
                arc_value = int32_t(state.elapsed % 3600 / 60);
                break;
            case proto::Mode::Break:
                arc_color = kPauseColor;
                break;
            case proto::Mode::Idle:
            case proto::Mode::Absent:
                arc_color = kDimColor;
                break;
            case proto::Mode::Select: {
                char idx[24];
                snprintf(idx, sizeof(idx), "%u / %u", unsigned(state.idx), unsigned(state.count));
                lv_label_set_text(s_idx, idx);
                lv_obj_set_style_text_color(s_name, lv_color_hex(state.color), 0);
                arc_value = state.count ? int32_t(60 * state.idx / state.count) : 60;
                break;
            }
        }
    }
    lv_obj_set_style_arc_color(s_arc, lv_color_hex(arc_color), LV_PART_INDICATOR);
    lv_arc_set_value(s_arc, arc_value);
    lv_label_set_text(s_name, name);
    lv_label_set_text(s_client, connected ? state.client : "");
    render_times(now_ms);
}

void tick(int64_t now_ms) {
    render_times(now_ms);
}

}  // namespace ui
