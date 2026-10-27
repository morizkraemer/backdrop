// Mandala: rings of petals turning against each other
// control: petals

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
0.5

//!PARAM petals
//!DESC Petals
//!TYPE DYNAMIC int
//!MINIMUM 3
//!MAXIMUM 24
8

//!PARAM rings
//!DESC Rings
//!TYPE DYNAMIC float
//!MINIMUM 2.0
//!MAXIMUM 12.0
5.0

//!PARAM hue
//!DESC Colour
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.9

//!PARAM spread
//!DESC Colour range
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.5

//!PARAM glow
//!DESC Glow
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 2.0
1.0

vec3 visual(vec2 uv, float t) {
    // Several mandalas across the wide wall: a big one in the middle and two half ones
    vec2 p = vec2((uv.x - 0.5) * ASPECT, uv.y - 0.5);
    float r = length(p) * 2.0;
    float a = atan(p.y, p.x);
    float ring = floor(r * rings);
    float dir = mod(ring, 2.0) < 1.0 ? 1.0 : -1.0;
    float n = float(petals) + ring * 2.0;
    float ang = a + dir * t * 0.3 / (1.0 + ring * 0.3);
    float petal = abs(cos(ang * n * 0.5));
    float fr = fract(r * rings);
    float shape = smoothstep(0.0, 0.08, petal - abs(fr * 2.0 - 1.0) * 0.9);
    float pulse = 0.6 + 0.4 * sin(t * 1.5 - ring * 0.8);
    vec3 col = hsv2rgb(vec3(hue + spread * ring / rings + t * 0.01, 0.85, shape * pulse));
    col += hsv2rgb(vec3(hue + 0.1, 0.6, 1.0)) * glow * 0.15 * exp(-r * 1.5);
    return col * smoothstep(rings * 0.25 + 1.2, 0.8, r);
}
