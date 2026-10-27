// Stripes: clean lines moving across the wall
// control: angle

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
1.0

//!PARAM stripes
//!DESC Stripes
//!TYPE DYNAMIC float
//!MINIMUM 2.0
//!MAXIMUM 60.0
12.0

//!PARAM width
//!DESC Line width
//!TYPE DYNAMIC float
//!MINIMUM 0.02
//!MAXIMUM 0.9
0.15

//!PARAM angle
//!DESC Angle
//!TYPE DYNAMIC float
//!MINIMUM -1.0
//!MAXIMUM 1.0
0.0

//!PARAM soft
//!DESC Softness
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.1

//!PARAM hue
//!DESC Colour
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.0

//!PARAM saturation
//!DESC Saturation
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.0

vec3 visual(vec2 uv, float t) {
    vec2 p = vec2((uv.x - 0.5) * ASPECT, uv.y - 0.5);
    float a = angle * PI * 0.5;
    float x = p.x * cos(a) + p.y * sin(a);
    float f = fract(x / ASPECT * stripes - t * 0.5);
    float d = abs(f - 0.5) * 2.0;           // 0 in the middle of a line
    float aa = max(soft, 0.02) * width;
    float level = 1.0 - smoothstep(width - aa, width + aa, d);
    return hsv2rgb(vec3(hue, saturation, level));
}
