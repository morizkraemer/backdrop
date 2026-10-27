// Lasers: beams fanning out from below and sweeping across the wall
// control: beams

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
1.0

//!PARAM beams
//!DESC Beams
//!TYPE DYNAMIC int
//!MINIMUM 1
//!MAXIMUM 24
8

//!PARAM spread
//!DESC Fan
//!TYPE DYNAMIC float
//!MINIMUM 0.1
//!MAXIMUM 1.5
0.8

//!PARAM sweep
//!DESC Sweep
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.6

//!PARAM width
//!DESC Beam width
//!TYPE DYNAMIC float
//!MINIMUM 0.2
//!MAXIMUM 3.0
1.0

//!PARAM hue
//!DESC Colour
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.33

//!PARAM rainbow
//!DESC Rainbow
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.0

//!PARAM haze
//!DESC Haze
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.3

vec3 visual(vec2 uv, float t) {
    // Beams start below the bottom edge in the middle
    vec2 p = vec2((uv.x - 0.5) * ASPECT, 1.0 - uv.y + 0.15);
    float a = atan(p.x, p.y);
    float r = length(p);
    vec3 col = vec3(0.0);
    int n = max(beams, 1);
    for (int i = 0; i < 24; i++) {
        if (i >= n) break;
        float f = n > 1 ? float(i) / float(n - 1) - 0.5 : 0.0;
        float ang = f * spread * 2.0 + sweep * 0.9 * sin(t * 0.8 + float(i) * 0.35);
        float d = abs(a - ang) * r;
        float w = 0.004 * width;
        float beam = w / (d + w) * smoothstep(0.0, 0.08, r);
        float h = hue + rainbow * f;
        col += hsv2rgb(vec3(h, 1.0 - 0.25 * beam, 1.0)) * beam * 0.6;
    }
    // Haze lit by the beams
    col += col * haze * fbm(vec2(uv.x * 4.0 + t * 0.2, uv.y * 2.0 - t * 0.1)) * 1.5;
    return col;
}
