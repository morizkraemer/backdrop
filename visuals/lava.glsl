// Lava: blobs rising and merging like a lava lamp
// control: blobs
// category: Organic

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
0.5

//!PARAM blobs
//!DESC Blobs
//!TYPE DYNAMIC int
//!MINIMUM 3
//!MAXIMUM 24
12

//!PARAM size
//!DESC Size
//!TYPE DYNAMIC float
//!MINIMUM 0.3
//!MAXIMUM 2.0
1.0

//!PARAM hue
//!DESC Colour
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.03

//!PARAM spread
//!DESC Colour range
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 0.5
0.1

//!PARAM softness
//!DESC Softness
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.4

vec3 visual(vec2 uv, float t) {
    vec2 p = vec2(uv.x * ASPECT, uv.y);
    float field = 0.0;
    for (int i = 0; i < 24; i++) {
        if (i >= blobs) break;
        float fi = float(i);
        float r1 = hash21(vec2(fi, 1.3));
        float r2 = hash21(vec2(fi, 7.1));
        // Each blob drifts up and down at its own pace and sways sideways
        float y = 0.5 + 0.55 * sin(t * (0.15 + r2 * 0.25) + r1 * 6.28);
        float x = (fi + 0.5) / float(blobs) * ASPECT + 0.15 * sin(t * 0.3 + r2 * 6.28);
        float rad = (0.06 + 0.08 * r1) * size;
        vec2 d = p - vec2(x, y);
        field += rad * rad / dot(d, d);
    }
    float edge = 1.0 - softness * 0.8;
    float m = smoothstep(edge - 0.15, edge + 0.15, field);
    vec3 col = hsv2rgb(vec3(hue + spread * clamp(field - 1.0, 0.0, 1.0), 0.9, 1.0)) * m;
    // Warm glow around the blobs
    col += hsv2rgb(vec3(hue, 1.0, 1.0)) * clamp(field, 0.0, 1.0) * 0.15;
    return col;
}
