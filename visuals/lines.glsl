// Lines: stacked waveforms, like a sound wave landscape
// control: amplitude
// category: Abstract

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
    float env = exp(-pow((uv.x - 0.5) * 3.0, 2.0));
    float k = amplitude * env * (n / 24.0 > 1.0 ? 24.0 / n : 1.0);
    // A line only rises from its base, by at most k / 2 (|w| <= 0.5): skip the
    // lines that can't reach this pixel, so most pixels evaluate one or two
    float reach = k * 0.5 + 0.004 * thickness;
    // Each line gets a peaked waveform, strongest in the middle
    int first = max(0, int(ceil((uv.y - 0.004 * thickness) * (n + 1.0))) - 1);
    int last = min(lines - 1, int(floor((uv.y + reach) * (n + 1.0))) - 1);
    for (int j = 0; j < 60; j++) {
        int i = first + j;
        if (i > last) break;
        float fi = float(i);
        float base = (fi + 1.0) / (n + 1.0);
        float w = fbm(vec2(x * 2.0 + fi * 0.37, t * 0.8 + fi * 0.21)) - 0.5;
        float yy = base - k * abs(w);
        float d = abs(uv.y - yy);
        float line = smoothstep(0.003 * thickness, 0.0, d - 0.0005 * thickness);
        col += hsv2rgb(vec3(hue + spread * base, 0.7, 1.0)) * line;
    }
    return col;
}
