// Ink: clouds of ink blooming and curling in water
// control: warp
// category: Organic

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
0.4

//!PARAM warp
//!DESC Swirl
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
1.8

//!PARAM scale
//!DESC Detail
//!TYPE DYNAMIC float
//!MINIMUM 0.5
//!MAXIMUM 5.0
1.6

//!PARAM hue
//!DESC Colour
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.62

//!PARAM spread
//!DESC Colour range
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.25

//!PARAM density
//!DESC Density
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.55

vec3 visual(vec2 uv, float t) {
    // From the middle, so Detail zooms around the centre of the wall
    vec2 p = (uv - 0.5) * vec2(ASPECT, 1.0) * scale;
    // Domain warping: the noise pushes itself around, which curls like ink
    vec2 q = vec2(fbm(p + vec2(0.0, t * 0.15)), fbm(p + vec2(5.2, 1.3) - t * 0.12));
    vec2 r = vec2(fbm(p + warp * q + vec2(1.7, 9.2) + t * 0.1), fbm(p + warp * q + vec2(8.3, 2.8) - t * 0.08));
    float v = fbm(p + warp * r);
    float ink = smoothstep(1.0 - density - 0.2, 1.0 - density + 0.35, v);
    vec3 col = hsv2rgb(vec3(hue + spread * (length(q) - 0.5), 0.75, 1.0)) * ink;
    // Bright edges where the ink is thin
    col += hsv2rgb(vec3(hue + spread * 0.5, 0.4, 1.0)) * pow(ink * (1.0 - ink) * 4.0, 3.0) * 0.4;
    return col;
}
