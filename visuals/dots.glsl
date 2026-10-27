// Dots: a grid of LED-style dots lit by a travelling wave

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
1.0

//!PARAM cells
//!DESC Dot count
//!TYPE DYNAMIC float
//!MINIMUM 2.0
//!MAXIMUM 48.0
12.0

//!PARAM dotsize
//!DESC Dot size
//!TYPE DYNAMIC float
//!MINIMUM 0.1
//!MAXIMUM 1.0
0.7

//!PARAM wave
//!DESC Wave length
//!TYPE DYNAMIC float
//!MINIMUM 0.2
//!MAXIMUM 6.0
1.5

//!PARAM hue
//!DESC Colour
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.1

//!PARAM spread
//!DESC Colour range
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.25

vec3 visual(vec2 uv, float t) {
    vec2 g = uv * vec2(ASPECT, 1.0) * cells;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    vec2 c = (id + 0.5) / cells / vec2(ASPECT, 1.0) - 0.5;
    float w = 0.5 + 0.5 * sin((c.x * ASPECT + c.y * 0.6) * 2.0 * PI / wave - t * 2.0
                              + 0.6 * sin(c.y * 4.0 + t));
    float d = length(f) * 2.0;
    float lit = 1.0 - smoothstep(dotsize * w - 0.08, dotsize * w, d);
    return hsv2rgb(vec3(hue + spread * w, 0.8, lit * (0.25 + 0.75 * w)));
}
