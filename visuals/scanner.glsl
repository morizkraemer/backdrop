// Scanner: light bars sweeping across the wall

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
1.0

//!PARAM bars
//!DESC Bars
//!TYPE DYNAMIC float
//!MINIMUM 1.0
//!MAXIMUM 12.0
3.0

//!PARAM width
//!DESC Width
//!TYPE DYNAMIC float
//!MINIMUM 0.01
//!MAXIMUM 0.5
0.08

//!PARAM hue
//!DESC Colour
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.55

//!PARAM saturation
//!DESC Saturation
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.6

//!PARAM angle
//!DESC Tilt
//!TYPE DYNAMIC float
//!MINIMUM -1.0
//!MAXIMUM 1.0
0.0

vec3 visual(vec2 uv, float t) {
    float x = uv.x + angle * (uv.y - 0.5) / ASPECT;
    // Each bar runs back and forth on its own phase
    float light = 0.0;
    for (int i = 0; i < 12; i++) {
        if (float(i) >= bars) break;
        float phase = float(i) / bars;
        float pos = 0.5 + 0.55 * sin(t * (0.8 + 0.15 * float(i)) + phase * 2.0 * PI);
        float d = abs(x - pos) / width;
        light += exp(-d * d * 4.0);
    }
    light = clamp(light, 0.0, 1.5);
    vec3 col = hsv2rgb(vec3(hue, saturation, 1.0));
    return col * light + vec3(pow(max(light - 1.0, 0.0), 2.0));
}
