// Bars: bars wiping and chasing across the wall
// Patterns: 0 wipe, 1 centre out, 2 in from the sides, 3 build up, 4 random,
// 5 run (one bar at a time), 6 bounce, 7 alternate, 8 scroll (all lit, moving)
// control: pattern
// category: Minimal

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
//!MAXIMUM 8
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

//!PARAM angle
//!DESC Angle
//!TYPE DYNAMIC float
//!MINIMUM -1.0
//!MAXIMUM 1.0
0.0

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
    // Position across the bars, 0-1 over the wall; Angle tilts them (1 = lying flat)
    float a = angle * PI * 0.5;
    vec2 dir = vec2(cos(a), sin(a));
    float reach = 0.5 * (ASPECT * abs(dir.x) + abs(dir.y));
    float x = dot((uv - 0.5) * vec2(ASPECT, 1.0), dir) / (2.0 * reach) + 0.5;
    // Scroll moves every bar along together
    if (pattern == 8) x = fract(x - t * 0.5 / n);
    float i = clamp(floor(x * n), 0.0, n - 1.0);
    float local = fract(x * n);
    float ph = fract(t * 0.5);
    float pos;
    if (pattern == 1) pos = abs(i + 0.5 - n * 0.5) / (n * 0.5);
    else if (pattern == 2) pos = 1.0 - abs(i + 0.5 - n * 0.5) / (n * 0.5);
    else pos = (i + 0.5) / n;
    // Stepped patterns jump one bar at a time, four steps a second at speed 1;
    // Lit width is their fading tail
    float beat = floor(t * 4.0);
    float step_ = fract(t * 4.0);
    float level;
    if (pattern == 5) {
        float age = mod(beat - i, n) + step_;
        level = age < 1.0 ? 1.0 : max(0.0, 1.0 - (age - 1.0) / (width * n));
    } else if (pattern == 6) {
        float period = max(2.0 * n - 2.0, 1.0);
        float k = mod(beat, period);
        float d = abs(i - (k < n ? k : period - k));
        level = d < 0.5 ? 1.0 : max(0.0, 1.0 - d / (width * n));
    } else if (pattern == 7) {
        level = mod(i + beat, 2.0) < 1.0 ? 1.0 : 0.0;
    } else if (pattern == 8) {
        // Lit width is the width of each line
        level = step(abs(local - 0.5) * 2.0, width);
    } else if (pattern == 3) {
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
