// Chase: blocks lighting up in turn across the wall
// Patterns: 0 run, 1 bounce, 2 fill, 3 random, 4 alternate
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

//!PARAM blocks
//!DESC Blocks
//!TYPE DYNAMIC int
//!MINIMUM 2
//!MAXIMUM 32
8

//!PARAM tail
//!DESC Tail
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.3

//!PARAM gap
//!DESC Gap between blocks
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 0.5
0.06

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
    float n = float(blocks);
    float i = min(floor(uv.x * n), n - 1.0);
    float local = fract(uv.x * n);
    float beat = floor(t * 4.0);   // four steps per second at speed 1
    float frac = fract(t * 4.0);
    int mode = pattern;
    float level = 0.0;
    if (mode == 0) {
        // Run: one block travels left to right, with a fading tail
        float age = mod(beat - i, n) + frac;
        level = age < 1.0 ? 1.0 : (tail > 0.0 ? max(0.0, 1.0 - (age - 1.0) / (tail * n)) : 0.0);
    } else if (mode == 1) {
        // Bounce: back and forth
        float period = max(2.0 * n - 2.0, 1.0);
        float k = mod(beat, period);
        float pos = k < n ? k : period - k;
        float d = abs(i - pos);
        level = d < 0.5 ? 1.0 : max(0.0, 1.0 - d / max(tail * n, 0.001));
    } else if (mode == 2) {
        // Fill: blocks light up one by one, then all go dark
        float k = mod(beat, n + 2.0);
        level = i < k ? 1.0 : 0.0;
    } else if (mode == 3) {
        // Random: each block flashes on its own beat
        float r = hash21(vec2(i, beat));
        level = r > 0.7 ? 1.0 - frac * tail * 2.0 : 0.0;
    } else {
        // Alternate: odd and even blocks swap
        level = mod(i + beat, 2.0) < 1.0 ? 1.0 : 0.0;
    }
    float edge = step(gap * 0.5, local) * step(local, 1.0 - gap * 0.5);
    return hsv2rgb(vec3(hue, saturation, clamp(level, 0.0, 1.0) * edge));
}
