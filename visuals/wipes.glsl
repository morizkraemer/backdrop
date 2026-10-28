// Wipes: hard-edged shapes wiping the wall from one colour to the other
// Patterns: 0 diagonal, 1 iris, 2 diamond, 3 clock, 4 split
// control: pattern

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
1.0

//!PARAM pattern
//!DESC Pattern
//!TYPE DYNAMIC int
//!MINIMUM 0
//!MAXIMUM 4
0

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

//!PARAM second
//!DESC Colour 2 level
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.0

vec3 visual(vec2 uv, float t) {
    vec2 p = (uv - 0.5) * vec2(ASPECT, 1.0);
    // How far along the wipe each pixel is, 0-1
    float m;
    if (pattern == 0) m = (uv.x * ASPECT + uv.y) / (ASPECT + 1.0);
    else if (pattern == 1) m = length(p) / length(vec2(ASPECT, 1.0) * 0.5);
    else if (pattern == 2) m = (abs(p.x) + abs(p.y)) / (ASPECT * 0.5 + 0.5);
    else if (pattern == 3) m = fract(atan(p.x, -p.y) / 6.2832 + 0.5);
    else m = abs(uv.x - 0.5) * 2.0;
    // One wipe every two seconds at speed 1, swapping the colours each time
    float k = t * 0.5;
    bool odd = mod(floor(k), 2.0) > 0.5;
    bool ahead = m < fract(k);
    bool first = ahead != odd;
    return first ? hsv2rgb(vec3(hue, saturation, 1.0)) : hsv2rgb(vec3(hue2, saturation, second));
}
