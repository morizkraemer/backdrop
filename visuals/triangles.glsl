// Triangles: a mesh of triangles flipping on and off
// Patterns: 0 random, 1 wave, 2 sweep
// control: fill

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
//!MAXIMUM 2
0

//!PARAM rows
//!DESC Rows
//!TYPE DYNAMIC int
//!MINIMUM 1
//!MAXIMUM 12
4

//!PARAM fill
//!DESC Lit
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.35

//!PARAM gap
//!DESC Gap
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 0.3
0.04

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
    float n = float(rows);
    vec2 g = vec2(uv.x * ASPECT, uv.y) * n;
    vec2 cell = floor(g);
    vec2 f = fract(g);
    // Every other square is cut along the other diagonal, so the cuts zigzag
    if (mod(cell.x + cell.y, 2.0) > 0.5) f.x = 1.0 - f.x;
    float half_ = f.x > f.y ? 1.0 : 0.0;
    vec3 id = vec3(cell, half_);
    float edge = min(min(min(f.x, f.y), min(1.0 - f.x, 1.0 - f.y)), abs(f.x - f.y) * 0.7071);
    float beat = floor(t * 2.0);
    float lit;
    if (pattern == 0) {
        lit = step(hash21(id.xy * 1.7 + id.z * 31.3 + beat * 0.137), fill);
    } else if (pattern == 1) {
        float w = sin(cell.x * 0.5 + cell.y * 0.9 + id.z * 0.4 - t * 3.0);
        lit = step(1.0 - 2.0 * fill, w);
    } else {
        float cols = floor(ASPECT * n);
        float pos = fract((cell.x + id.z * 0.5) / max(cols, 1.0) - t * 0.25);
        lit = step(pos, fill);
    }
    lit *= step(gap * 0.5, edge);
    return hsv2rgb(vec3(hue, saturation, lit));
}
