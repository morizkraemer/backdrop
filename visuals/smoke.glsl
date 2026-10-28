// Smoke: slow flowing noise, like haze in a beam

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
0.4

//!PARAM scale
//!DESC Detail
//!TYPE DYNAMIC float
//!MINIMUM 0.5
//!MAXIMUM 6.0
1.6

//!PARAM hue
//!DESC Colour
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.75

//!PARAM contrast
//!DESC Contrast
//!TYPE DYNAMIC float
//!MINIMUM 0.5
//!MAXIMUM 4.0
1.6

//!PARAM saturation
//!DESC Saturation
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.7

vec3 visual(vec2 uv, float t) {
    // From the middle, so Detail zooms around the centre of the wall
    vec2 p = (uv - 0.5) * vec2(ASPECT, 1.0) * scale;
    vec2 q = vec2(fbm(p + vec2(0.0, t * 0.15)), fbm(p + vec2(5.2, 1.3) - t * 0.1));
    float v = fbm(p + 2.5 * q + vec2(t * 0.2, 0.0));
    v = clamp(pow(v, contrast) * 1.6, 0.0, 1.0);
    return hsv2rgb(vec3(hue + 0.08 * q.x, saturation * (1.0 - 0.4 * v), v));
}
