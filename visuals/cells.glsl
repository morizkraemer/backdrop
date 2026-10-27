// Cells: pulsing Voronoi cells, like stained glass
// control: cells

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
0.8

//!PARAM cells
//!DESC Cells
//!TYPE DYNAMIC float
//!MINIMUM 2.0
//!MAXIMUM 30.0
8.0

//!PARAM edge
//!DESC Edges
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.5

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
0.4

//!PARAM pulse
//!DESC Pulse
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.6

vec3 visual(vec2 uv, float t) {
    vec2 p = vec2(uv.x * ASPECT, uv.y) * cells;
    vec2 ip = floor(p);
    vec2 fp = fract(p);
    float d1 = 8.0;
    float d2 = 8.0;
    vec2 best = vec2(0.0);
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 o = vec2(float(i), float(j));
            vec2 id = ip + o;
            vec2 c = o + 0.5 + 0.4 * sin(t * 0.7 + 6.28 * vec2(hash21(id), hash21(id + 3.1)));
            float d = length(c - fp);
            if (d < d1) { d2 = d1; d1 = d; best = id; }
            else if (d < d2) d2 = d;
        }
    }
    float r = hash21(best);
    float lum = 1.0 - pulse + pulse * (0.5 + 0.5 * sin(t * 2.0 + r * 6.28));
    float border = smoothstep(0.0, 0.06, d2 - d1);
    vec3 c = hsv2rgb(vec3(hue + spread * r, 0.8, lum * (0.35 + 0.65 * (1.0 - d1))));
    return c * mix(1.0, border, edge);
}
