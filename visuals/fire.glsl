// Fire: flames licking up from the bottom of the wall
// control: height
// category: Organic

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
1.0

//!PARAM height
//!DESC Height
//!TYPE DYNAMIC float
//!MINIMUM 0.2
//!MAXIMUM 1.5
0.7

//!PARAM turbulence
//!DESC Turbulence
//!TYPE DYNAMIC float
//!MINIMUM 0.5
//!MAXIMUM 4.0
1.8

//!PARAM hue
//!DESC Colour
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.02

//!PARAM spread
//!DESC Colour range
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 0.3
0.1

vec3 visual(vec2 uv, float t) {
    vec2 p = vec2(uv.x * ASPECT * 2.0, 1.0 - uv.y);
    float n = fbm(vec2(p.x * turbulence, p.y * turbulence * 1.5 - t * 2.5));
    n = n * 0.7 + 0.3 * fbm(vec2(p.x * turbulence * 2.0 + 7.0, p.y * 3.0 - t * 4.0));
    // Fuel at the bottom, thinning out with height and noise
    float f = clamp(1.0 - p.y / height + (n - 0.5) * 1.6, 0.0, 1.0);
    f = f * f;
    // Dark red at the tips, orange, then yellow-white in the core
    float core = pow(f, 3.0);
    return hsv2rgb(vec3(hue + spread * f, 1.0 - core * 0.7, min(f * 1.6, 1.0)));
}
