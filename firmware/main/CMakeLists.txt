# No REQUIRES: the main component depends on all components, including the managed ones from idf_component.yml.
idf_component_register(
    SRCS
        "main.cpp"
        "protocol.cpp"
        "button.cpp"
        "usb_link.c"
        "lcd_st77961.c"
        "ui.cpp"
        "leds.cpp"
        "input.cpp"
        "power.cpp"
    INCLUDE_DIRS "."
    EMBED_FILES "fonts/Montserrat-Medium.ttf"
)
