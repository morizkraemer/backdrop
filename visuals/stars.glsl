// Stars: a starfield flying towards the audience

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
1.0

//!PARAM density
//!DESC Stars
//!TYPE DYNAMIC float
//!MINIMUM 0.2
//!MAXIMUM 3.0
1.0

//!PARAM hue
//!DESC Colour
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.6

//!PARAM saturation
//!DESC Saturation
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.2

//!PARAM trail
//!DESC Streaks
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.15

vec3 visual(vec2 uv, float t) {
    vec2 p = (uv - 0.5) * vec2(ASPECT, 1.0);
    vec3 col = vec3(0.0);
    for (int layer = 0; layer < 6; layer++) {
        float depth = fract(float(layer) / 6.0 + t * 0.12);
        float scale = mix(18.0, 0.6, depth) / density;
        float fade = smoothstep(0.0, 0.3, depth) * smoothstep(1.0, 0.85, depth);
        vec2 q = p * scale + float(layer) * 7.13;
        vec2 id = floor(q);
        vec2 f = fract(q) - 0.5;
        float h = hash21(id);
        if (h > 0.35 * density) continue;
        vec2 off = vec2(hash21(id + 3.1), hash21(id + 7.7)) - 0.5;
        vec2 d = f - off * 0.7;
        // Stretch each star along its direction from the centre for streaks
        vec2 dir = normalize(p + 1e-4);
        float along = dot(d, dir);
        float across = dot(d, vec2(-dir.y, dir.x));
        float s = length(vec2(along / (1.0 + trail * 6.0 * depth), across));
        float star = smoothstep(0.06 * depth + 0.01, 0.0, s);
        col += star * fade * hsv2rgb(vec3(hue + 0.1 * h, saturation, 1.0));
    }
    return col;
}
