// Synthwave: retro sun over a scrolling neon grid
// control: sun

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
1.0

//!PARAM sun
//!DESC Sun size
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 0.6
0.32

//!PARAM horizon
//!DESC Horizon
//!TYPE DYNAMIC float
//!MINIMUM 0.3
//!MAXIMUM 0.8
0.55

//!PARAM grid
//!DESC Grid density
//!TYPE DYNAMIC float
//!MINIMUM 4.0
//!MAXIMUM 40.0
14.0

//!PARAM hue
//!DESC Grid colour
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.83

//!PARAM glow
//!DESC Glow
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 2.0
1.0

vec3 visual(vec2 uv, float t) {
    float y = uv.y;
    vec2 p = vec2((uv.x - 0.5) * ASPECT, y);
    vec3 col = mix(vec3(0.15, 0.0, 0.25), vec3(0.0), clamp((horizon - y) / horizon, 0.0, 1.0));
    if (y < horizon) {
        // Sun with stripes cut through its lower half
        vec2 c = vec2(0.0, horizon - sun * 0.55);
        float d = length(p - c);
        float body = smoothstep(sun, sun - 0.01, d);
        float k = (y - (c.y - sun)) / (2.0 * sun);
        float stripes = step(0.5, fract(k * 10.0 - t * 0.3)) + step(k, 0.55);
        col += mix(vec3(1.0, 0.85, 0.2), vec3(1.0, 0.1, 0.55), k) * body * clamp(stripes, 0.0, 1.0);
        col += vec3(1.0, 0.2, 0.6) * glow * 0.25 * exp(-max(d - sun, 0.0) * 8.0);
    } else {
        // Ground grid in perspective
        float z = 1.0 / max(y - horizon, 0.001);
        float gx = p.x * z;
        float gz = z + t * 2.0;
        float lx = abs(fract(gx * grid * 0.05) - 0.5) / (grid * 0.05 * z * 0.02 + 0.001);
        float lz = abs(fract(gz * 0.5) - 0.5) / (0.5 * z * 0.02 + 0.001);
        float line = clamp(1.0 - min(lx, lz) * 0.5, 0.0, 1.0);
        float fade = clamp((y - horizon) * 4.0, 0.0, 1.0);
        col = hsv2rgb(vec3(hue, 0.8, 1.0)) * line * fade * (0.6 + 0.4 * glow) + vec3(0.05, 0.0, 0.08);
    }
    return col;
}
