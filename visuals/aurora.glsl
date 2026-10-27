// Aurora: northern lights curtains rippling across the sky
// control: height

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
0.5

//!PARAM height
//!DESC Height
//!TYPE DYNAMIC float
//!MINIMUM 0.1
//!MAXIMUM 1.0
0.6

//!PARAM bands
//!DESC Curtains
//!TYPE DYNAMIC float
//!MINIMUM 1.0
//!MAXIMUM 6.0
3.0

//!PARAM hue
//!DESC Colour
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.38

//!PARAM spread
//!DESC Colour range
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.35

//!PARAM stars
//!DESC Stars
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.5

vec3 visual(vec2 uv, float t) {
    float x = uv.x * ASPECT;
    float y = 1.0 - uv.y;
    vec3 col = vec3(0.0, 0.01, 0.03) * (1.0 - y);
    // Stars behind
    vec2 g = floor(uv * vec2(ASPECT * 90.0, 90.0));
    float s = hash21(g);
    col += vec3(step(0.996, s) * stars * (0.6 + 0.4 * sin(t * 3.0 + s * 50.0)));
    for (int i = 0; i < 6; i++) {
        if (float(i) >= bands) break;
        float fi = float(i);
        float base = 0.25 + 0.5 * fi / max(bands, 1.0) * height;
        float wave = base + 0.12 * sin(x * 0.9 + t * 0.6 + fi * 1.7) + 0.06 * fbm(vec2(x * 1.5 + fi * 3.0, t * 0.3));
        float d = y - wave;
        // Sharp bottom edge, long glow upwards
        float curtain = d > 0.0 ? exp(-d * 6.0 / height) : exp(d * 60.0);
        float rays = 0.5 + 0.5 * fbm(vec2(x * 6.0 + fi * 5.0, t * 0.5));
        col += hsv2rgb(vec3(hue + spread * (d * 2.0 + fi * 0.15), 0.8, 1.0)) * curtain * rays * 0.7;
    }
    return col;
}
