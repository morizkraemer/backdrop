// Glitch: digital tearing, blocks and colour splits
// control: amount

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
1.0

//!PARAM amount
//!DESC Amount
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.5

//!PARAM hue
//!DESC Colour
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.5

//!PARAM split
//!DESC Colour split
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.5

//!PARAM scanlines
//!DESC Scanlines
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.4

float glitchBase(vec2 uv, float t) {
    // Moving bars underneath the glitch
    return 0.5 + 0.5 * sin(uv.x * 18.0 + t * 2.0 + 3.0 * sin(uv.y * 4.0 + t));
}

vec3 visual(vec2 uv, float t) {
    float tick = floor(t * 8.0);
    // Horizontal bands jump sideways now and then
    float band = floor(uv.y * 24.0);
    float r = hash21(vec2(band, tick));
    vec2 q = uv;
    if (r < amount * 0.5) q.x += (hash21(vec2(band, tick + 1.0)) - 0.5) * 0.4 * amount;
    // Blocks blink out or invert
    vec2 blk = floor(uv * vec2(32.0, 10.0));
    float b = hash21(blk + tick * 1.7);
    float off = split * 0.02 * (1.0 + 4.0 * step(1.0 - amount * 0.3, r));
    vec3 col = vec3(glitchBase(q + vec2(off, 0.0), t), glitchBase(q, t), glitchBase(q - vec2(off, 0.0), t));
    col *= hsv2rgb(vec3(hue + 0.1 * col.g, 0.6, 1.0));
    if (b < amount * 0.12) col = vec3(1.0) - col;
    if (b > 1.0 - amount * 0.08) col = vec3(0.0);
    col *= 1.0 - scanlines * 0.5 * step(0.5, fract(uv.y * 192.0));
    return col;
}
