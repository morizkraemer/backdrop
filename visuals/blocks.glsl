// Blocks: the wall cut into hard rectangles that re-cut on the beat
// control: cuts

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
1.0

//!PARAM cuts
//!DESC Cuts
//!TYPE DYNAMIC int
//!MINIMUM 1
//!MAXIMUM 7
4

//!PARAM fill
//!DESC Lit
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.4

//!PARAM line
//!DESC Line width
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 0.05
0.01

//!PARAM hue
//!DESC Colour 1
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.0

//!PARAM hue2
//!DESC Colour 2
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.6

//!PARAM saturation
//!DESC Saturation
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.0

vec3 visual(vec2 uv, float t) {
    float beat = floor(t);
    // Cut the wall in two again and again, keeping the part this pixel is in
    vec2 lo = vec2(0.0);
    vec2 hi = vec2(1.0);
    float id = 1.0;
    for (int k = 0; k < 7; k++) {
        if (k >= cuts) break;
        vec2 size = (hi - lo) * vec2(ASPECT, 1.0);
        float r = hash21(vec2(id, beat + 0.5));
        float at = 0.3 + 0.4 * hash21(vec2(id * 1.3, beat + 9.1));
        // Cut across the longer side
        if (size.x > size.y) {
            float x = mix(lo.x, hi.x, at);
            if (uv.x < x) { hi.x = x; id = id * 2.0; } else { lo.x = x; id = id * 2.0 + 1.0; }
        } else {
            float y = mix(lo.y, hi.y, at);
            if (uv.y < y) { hi.y = y; id = id * 2.0; } else { lo.y = y; id = id * 2.0 + 1.0; }
        }
        id += r;
    }
    float h = hash21(vec2(id, beat + 3.3));
    // Distance to this block's edges, in wall heights
    vec2 d = min(uv - lo, hi - uv) * vec2(ASPECT, 1.0);
    float inside = step(line * 0.5, min(d.x, d.y));
    vec3 col = vec3(0.0);
    if (h < fill * 0.6) col = hsv2rgb(vec3(hue, saturation, 1.0));
    else if (h < fill) col = hsv2rgb(vec3(hue2, max(saturation, 0.6), 1.0));
    return col * inside;
}
