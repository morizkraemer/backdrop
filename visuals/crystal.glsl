// Crystal: a kaleidoscope of sharp glassy facets
// control: facets

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
0.5

//!PARAM facets
//!DESC Mirrors
//!TYPE DYNAMIC int
//!MINIMUM 3
//!MAXIMUM 16
8

//!PARAM zoom
//!DESC Zoom
//!TYPE DYNAMIC float
//!MINIMUM 0.5
//!MAXIMUM 6.0
2.5

//!PARAM hue
//!DESC Colour
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.55

//!PARAM spread
//!DESC Colour range
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.6

//!PARAM sparkle
//!DESC Sparkle
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.5

vec3 visual(vec2 uv, float t) {
    vec2 p = vec2((uv.x - 0.5) * ASPECT, uv.y - 0.5);
    float r = length(p);
    float a = atan(p.y, p.x) + t * 0.1;
    float seg = 2.0 * PI / float(max(facets, 3));
    a = abs(mod(a, seg) - seg * 0.5);
    vec2 q = vec2(cos(a), sin(a)) * r * zoom + vec2(t * 0.2, 0.0);
    // Facets: sharp-edged cells from layered triangle grids
    vec2 g1 = fract(q * 1.0) - 0.5;
    vec2 g2 = fract(mat2(0.8, -0.6, 0.6, 0.8) * q * 1.7 + t * 0.05) - 0.5;
    float f1 = max(abs(g1.x), abs(g1.y) + abs(g1.x) * 0.5);
    float f2 = max(abs(g2.x), abs(g2.y) + abs(g2.x) * 0.5);
    float facet = floor(f1 * 6.0) / 6.0 + floor(f2 * 4.0) / 8.0;
    float edges = smoothstep(0.46, 0.49, abs(fract(f1 * 6.0) - 0.5)) + smoothstep(0.45, 0.49, abs(fract(f2 * 4.0) - 0.5));
    vec3 col = hsv2rgb(vec3(hue + spread * facet, 0.8, 0.2 + 0.8 * pow(fract(facet * 3.7 + t * 0.1), 2.0)));
    col += hsv2rgb(vec3(hue + 0.1, 0.3, 1.0)) * edges * 0.5;
    float s = hash21(floor(q * 12.0) + floor(t * 3.0));
    col += vec3(step(1.0 - sparkle * 0.03, s));
    return col * smoothstep(1.2, 0.6, r / (0.5 * ASPECT));
}
