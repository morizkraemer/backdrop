// Marble: slow liquid marbling of two colours
// control: bands
// category: Organic

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
0.4

//!PARAM bands
//!DESC Bands
//!TYPE DYNAMIC float
//!MINIMUM 1.0
//!MAXIMUM 12.0
4.0

//!PARAM warp
//!DESC Flow
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
2.0

//!PARAM hue
//!DESC Colour 1
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.58

//!PARAM hue2
//!DESC Colour 2
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.78

//!PARAM sheen
//!DESC Sheen
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.5

vec3 visual(vec2 uv, float t) {
    vec2 p = vec2(uv.x * ASPECT, uv.y) * 1.5;
    vec2 w = vec2(fbm(p + vec2(t * 0.1, 0.0)), fbm(p + vec2(3.1, t * 0.08)));
    float v = sin((p.x + p.y * 0.4 + warp * fbm(p + w * 2.0 + t * 0.05)) * bands);
    float m = 0.5 + 0.5 * v;
    vec3 c1 = hsv2rgb(vec3(hue, 0.75, 0.55));
    vec3 c2 = hsv2rgb(vec3(hue2, 0.65, 0.75));
    vec3 col = mix(c1, c2, smoothstep(0.3, 0.7, m));
    // Thin bright veins where the colours meet, and a dark fold
    col += vec3(sheen) * pow(1.0 - abs(v), 12.0);
    col *= 0.55 + 0.45 * smoothstep(-1.0, 0.2, v);
    return col;
}
