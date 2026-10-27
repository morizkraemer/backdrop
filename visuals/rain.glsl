// Rain: columns of falling glowing code
// control: density

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
1.0

//!PARAM density
//!DESC Density
//!TYPE DYNAMIC float
//!MINIMUM 0.1
//!MAXIMUM 1.0
0.6

//!PARAM columns
//!DESC Columns
//!TYPE DYNAMIC float
//!MINIMUM 20.0
//!MAXIMUM 200.0
90.0

//!PARAM hue
//!DESC Colour
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.33

//!PARAM trail
//!DESC Trail
//!TYPE DYNAMIC float
//!MINIMUM 0.05
//!MAXIMUM 1.0
0.35

vec3 visual(vec2 uv, float t) {
    float cols = floor(columns);
    float rows = floor(cols / ASPECT);
    vec2 cell = floor(uv * vec2(cols, rows));
    vec2 f = fract(uv * vec2(cols, rows));
    float rnd = hash21(vec2(cell.x, 7.0));
    if (rnd > density) return vec3(0.0);
    // A drop falls down each column at its own speed; the trail fades behind it
    float fall = t * (0.3 + rnd) * 0.6 + rnd * 10.0;
    float head = fract(fall) * (1.0 + trail) ;
    float y = cell.y / rows;
    float d = head - y;
    if (d < 0.0 || d > trail) return vec3(0.0);
    float b = 1.0 - d / trail;
    // Glyphs: blocky pattern that changes now and then
    float glyph = step(0.45, hash21(cell + floor(f * 3.0) * 13.0 + floor(t * 4.0 * hash21(cell))));
    float lead = step(d, 1.0 / rows);
    vec3 c = hsv2rgb(vec3(hue, 0.9 - 0.8 * lead, 1.0));
    return c * b * b * glyph;
}
