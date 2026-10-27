// Lines: stacked waveforms, like a sound wave landscape
// control: amplitude

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
1.0

//!PARAM lines
//!DESC Lines
//!TYPE DYNAMIC int
//!MINIMUM 4
//!MAXIMUM 60
24

//!PARAM amplitude
//!DESC Amplitude
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.5

//!PARAM thickness
//!DESC Thickness
//!TYPE DYNAMIC float
//!MINIMUM 0.3
//!MAXIMUM 4.0
1.0

//!PARAM hue
//!DESC Colour
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.55

//!PARAM spread
//!DESC Colour range
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.2

vec3 visual(vec2 uv, float t) {
    float n = float(lines);
    vec3 col = vec3(0.0);
    float x = uv.x * ASPECT;
    // Each line gets a peaked waveform, strongest in the middle
    for (int i = 0; i < 60; i++) {
        if (i >= lines) break;
        float fi = float(i);
        float base = (fi + 1.0) / (n + 1.0);
        float env = exp(-pow((uv.x - 0.5) * 3.0, 2.0));
        float w = fbm(vec2(x * 2.0 + fi * 0.37, t * 0.8 + fi * 0.21)) - 0.5;
        float yy = base - amplitude * env * abs(w) * 0.5 * (n / 24.0 > 1.0 ? 24.0 / n : 1.0) * 2.0;
        float d = abs(uv.y - yy);
        float line = smoothstep(0.003 * thickness, 0.0, d - 0.0005 * thickness);
        col += hsv2rgb(vec3(hue + spread * base, 0.7, 1.0)) * line;
    }
    return col;
}
