// Plasma: soft colour clouds drifting across the wall

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
0.5

//!PARAM scale
//!DESC Size
//!TYPE DYNAMIC float
//!MINIMUM 0.5
//!MAXIMUM 8.0
2.0

//!PARAM hue
//!DESC Colour
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.6

//!PARAM spread
//!DESC Colour range
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.35

//!PARAM saturation
//!DESC Saturation
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.9

vec3 visual(vec2 uv, float t) {
    vec2 p = (uv - 0.5) * vec2(ASPECT, 1.0) * scale;
    float v = sin(p.x * 1.3 + t)
            + sin((p.y * 1.7 - t * 0.8))
            + sin((p.x + p.y) * 0.9 + t * 0.6)
            + sin(length(p + vec2(sin(t * 0.3), cos(t * 0.4)) * 2.0) * 1.5 - t);
    v = v * 0.25 + 0.5;
    return hsv2rgb(vec3(hue + spread * v, saturation, 0.35 + 0.65 * v));
}
