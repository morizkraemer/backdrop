// Grid: a grid of cells lighting in sequence
// Patterns: 0 reading order, 1 snake, 2 columns, 3 rows, 4 random, 5 checker
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
//!MAXIMUM 5
1

//!PARAM cols
//!DESC Columns
//!TYPE DYNAMIC int
//!MINIMUM 2
//!MAXIMUM 48
12

//!PARAM rows
//!DESC Rows
//!TYPE DYNAMIC int
//!MINIMUM 1
//!MAXIMUM 16
4

//!PARAM tail
//!DESC Tail
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.2

//!PARAM gap
//!DESC Gap
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 0.5
0.12

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
    vec2 n = vec2(float(cols), float(rows));
    vec2 c = min(floor(uv * n), n - 1.0);
    vec2 local = fract(uv * n);
    float total = n.x * n.y;
    float beat = t * 6.0;
    float idx;
    if (pattern == 1) idx = c.y * n.x + (mod(c.y, 2.0) < 1.0 ? c.x : n.x - 1.0 - c.x);
    else idx = c.y * n.x + c.x;
    float level = 0.0;
    if (pattern <= 1) {
        float age = mod(floor(beat) - idx, total) + fract(beat);
        level = age < 1.0 ? 1.0 : max(0.0, 1.0 - (age - 1.0) / max(tail * total, 0.001));
    } else if (pattern == 2) {
        float age = mod(floor(beat * 0.5) - c.x, n.x) + fract(beat * 0.5);
        level = age < 1.0 ? 1.0 : max(0.0, 1.0 - (age - 1.0) / max(tail * n.x, 0.001));
    } else if (pattern == 3) {
        float age = mod(floor(beat * 0.3) - c.y, n.y) + fract(beat * 0.3);
        level = age < 1.0 ? 1.0 : 0.0;
    } else if (pattern == 4) {
        level = step(0.8, hash21(c + floor(beat * 0.5) * 7.3));
    } else {
        level = mod(c.x + c.y + floor(beat * 0.25), 2.0) < 1.0 ? 1.0 : 0.0;
    }
    vec2 inside = step(vec2(gap * 0.5), local) * step(local, vec2(1.0 - gap * 0.5));
    return hsv2rgb(vec3(hue, saturation, level * inside.x * inside.y));
}
