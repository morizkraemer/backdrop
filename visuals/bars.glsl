// Bars: bars wiping across the wall
// Patterns: 0 wipe, 1 centre out, 2 in from the sides, 3 build up, 4 random
// control: pattern

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
1.0

//!PARAM pattern
//!DESC Pattern
//!TYPE DYNAMIC int
//!MINIMUM 0
//!MAXIMUM 4
0

//!PARAM bars
//!DESC Bars
//!TYPE DYNAMIC int
//!MINIMUM 2
//!MAXIMUM 64
16

//!PARAM width
//!DESC Lit width
//!TYPE DYNAMIC float
//!MINIMUM 0.05
//!MAXIMUM 1.0
0.25

//!PARAM gap
//!DESC Gap between bars
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 0.5
0.15

//!PARAM hue
//!DESC Colour
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.0

//!PARAM saturation
//!DESC Saturation
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.0

vec3 visual(vec2 uv, float t) {
    float n = float(bars);
    float i = min(floor(uv.x * n), n - 1.0);
    float local = fract(uv.x * n);
    float ph = fract(t * 0.5);
    float pos;
    if (pattern == 1) pos = abs(i + 0.5 - n * 0.5) / (n * 0.5);
    else if (pattern == 2) pos = 1.0 - abs(i + 0.5 - n * 0.5) / (n * 0.5);
    else pos = (i + 0.5) / n;
    float level;
    if (pattern == 3) {
        // Bars stay lit as the wipe passes, then all drop together
        level = pos < ph * 1.2 ? 1.0 : 0.0;
    } else if (pattern == 4) {
        level = step(1.0 - width, hash21(vec2(i, floor(t * 4.0))));
    } else {
        // A lit band travels through, fading at its tail
        float d = fract(ph - pos);
        level = d < width ? 1.0 - d / width : 0.0;
    }
    float edge = step(gap * 0.5, local) * step(local, 1.0 - gap * 0.5);
    return hsv2rgb(vec3(hue, saturation, level * edge));
}
