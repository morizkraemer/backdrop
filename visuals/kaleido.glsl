// Kaleido: a kaleidoscope of drifting colour
// control: segments

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
0.6

//!PARAM segments
//!DESC Mirrors
//!TYPE DYNAMIC int
//!MINIMUM 2
//!MAXIMUM 16
6

//!PARAM zoom
//!DESC Zoom
//!TYPE DYNAMIC float
//!MINIMUM 0.5
//!MAXIMUM 6.0
2.0

//!PARAM twist
//!DESC Twist
//!TYPE DYNAMIC float
//!MINIMUM -2.0
//!MAXIMUM 2.0
0.3

//!PARAM hue
//!DESC Colour
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.8

//!PARAM spread
//!DESC Colour range
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.5

//!PARAM contrast
//!DESC Contrast
//!TYPE DYNAMIC float
//!MINIMUM 0.5
//!MAXIMUM 4.0
1.8

vec3 visual(vec2 uv, float t) {
    vec2 p = vec2((uv.x - 0.5) * ASPECT, uv.y - 0.5);
    float r = length(p);
    float a = atan(p.y, p.x) + twist * t * 0.3;
    float seg = 2.0 * PI / float(max(segments, 2));
    a = mod(a, seg);
    a = abs(a - seg * 0.5);
    vec2 q = vec2(cos(a), sin(a)) * r * zoom;
    float v = fbm(q * 2.0 + vec2(t * 0.4, -t * 0.25));
    v = fbm(q + vec2(v * 2.0, t * 0.2));
    v = clamp((v - 0.25) * 2.0, 0.0, 1.0);
    float lum = pow(v, contrast);
    // Bright rims where the pattern folds, vivid colour cycling with the pattern
    float rim = pow(1.0 - abs(v * 2.0 - 1.0), 6.0);
    return hsv2rgb(vec3(hue + spread * (v * 1.5 + r * 0.4) + t * 0.02, 0.9 - 0.4 * rim, lum + rim * 0.5));
}
