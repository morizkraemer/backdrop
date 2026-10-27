// Tunnel: rings pulsing out from the centre

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
1.0

//!PARAM rings
//!DESC Ring density
//!TYPE DYNAMIC float
//!MINIMUM 1.0
//!MAXIMUM 20.0
6.0

//!PARAM twist
//!DESC Twist
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
0.0

//!PARAM hue
//!DESC Colour
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.0

//!PARAM spread
//!DESC Ring colours
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.15

//!PARAM sharpness
//!DESC Edge sharpness
//!TYPE DYNAMIC float
//!MINIMUM 1.0
//!MAXIMUM 12.0
3.0

vec3 visual(vec2 uv, float t) {
    vec2 p = (uv - 0.5) * vec2(ASPECT, 1.0);
    float r = length(p);
    float a = atan(p.y, p.x);
    float z = r * rings - t + twist * a / PI;
    float ring = pow(0.5 + 0.5 * cos(z * 2.0 * PI), sharpness);
    float fade = smoothstep(0.0, 0.15, r);
    return hsv2rgb(vec3(hue + spread * floor(z), 0.85, ring * fade));
}
