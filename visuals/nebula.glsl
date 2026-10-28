// Nebula: glowing gas clouds and stars drifting in deep space
// control: glow

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
0.3

//!PARAM glow
//!DESC Glow
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 3.0
1.6

//!PARAM scale
//!DESC Detail
//!TYPE DYNAMIC float
//!MINIMUM 0.5
//!MAXIMUM 4.0
1.4

//!PARAM hue
//!DESC Colour
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.75

//!PARAM spread
//!DESC Colour range
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.4

//!PARAM stars
//!DESC Stars
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.6

vec3 visual(vec2 uv, float t) {
    // From the middle, so Detail zooms around the centre of the wall
    vec2 p = (uv - 0.5) * vec2(ASPECT, 1.0) * scale;
    vec2 drift = vec2(t * 0.05, t * 0.02);
    float a = fbm(p * 1.2 + drift + fbm(p * 0.8 - drift) * 1.5);
    float b = fbm(p * 2.3 - drift * 1.7 + 4.0);
    float gas = pow(clamp(a * 1.6 - 0.3, 0.0, 1.0), 1.6) * glow;
    float dust = smoothstep(0.45, 0.75, b);
    vec3 col = hsv2rgb(vec3(hue + spread * (a - 0.5), 0.7, 1.0)) * gas;
    col += hsv2rgb(vec3(hue + spread * 0.6, 0.8, 1.0)) * pow(gas, 2.0) * 0.6;
    col *= 1.0 - dust * 0.6;
    // Stars, a few big twinkling ones
    vec2 g = floor(uv * vec2(ASPECT * 120.0, 120.0));
    float s = hash21(g);
    float tw = 0.6 + 0.4 * sin(t * 4.0 + s * 80.0);
    col += vec3(step(0.997, s) * stars * tw) * (0.5 + gas);
    return col;
}
