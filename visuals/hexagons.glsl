// Hexagons: a honeycomb with waves of light running through it
// control: size

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
1.0

//!PARAM size
//!DESC Size
//!TYPE DYNAMIC float
//!MINIMUM 3.0
//!MAXIMUM 30.0
10.0

//!PARAM wave
//!DESC Wave type
//!TYPE DYNAMIC int
//!MINIMUM 0
//!MAXIMUM 2
0

//!PARAM hue
//!DESC Colour
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.1

//!PARAM spread
//!DESC Colour range
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.3

//!PARAM gap
//!DESC Gap
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 0.3
0.08

vec4 hexCell(vec2 p) {
    // Nearest hexagon centre: returns (local offset, cell id)
    vec2 s = vec2(1.0, 1.7320508);
    vec2 h = s * 0.5;
    vec2 a = mod(p, s) - h;
    vec2 b = mod(p - h, s) - h;
    vec2 g = dot(a, a) < dot(b, b) ? a : b;
    return vec4(g, p - g);
}

vec3 visual(vec2 uv, float t) {
    vec2 p = vec2(uv.x * ASPECT, uv.y) * size;
    vec4 c = hexCell(p);
    vec2 g = abs(c.xy);
    float edgeDist = 0.5 - max(dot(g, normalize(vec2(1.0, 1.7320508))), g.x);
    vec2 id = c.zw / size;
    float ph;
    if (wave == 0) ph = id.x / ASPECT;
    else if (wave == 1) ph = length(id - vec2(ASPECT * 0.5, 0.5));
    else ph = hash21(floor(c.zw * 10.0));
    float lum = pow(0.5 + 0.5 * sin((ph * 6.0 - t * 1.5) * PI), 3.0);
    float inside = smoothstep(gap * 0.5, gap * 0.5 + 0.02, edgeDist);
    return hsv2rgb(vec3(hue + spread * ph, 0.85, 0.08 + 0.92 * lum)) * inside;
}
