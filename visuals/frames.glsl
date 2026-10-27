// Frames: rectangles opening out from the centre of the wall
// control: frames

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
1.0

//!PARAM frames
//!DESC Frames
//!TYPE DYNAMIC float
//!MINIMUM 1.0
//!MAXIMUM 12.0
4.0

//!PARAM width
//!DESC Line width
//!TYPE DYNAMIC float
//!MINIMUM 0.02
//!MAXIMUM 0.6
0.12

//!PARAM reverse
//!DESC Inwards
//!TYPE DYNAMIC int
//!MINIMUM 0
//!MAXIMUM 1
0

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
    // Distance to the centre with the wall's shape, so the frames follow its edges
    vec2 p = abs(uv - 0.5) * 2.0;
    float d = max(p.x, p.y);
    float dir = reverse == 1 ? 1.0 : -1.0;
    float f = fract(d * frames + dir * t * 0.5);
    float line = step(1.0 - width, 1.0 - abs(f - 0.5) * 2.0);
    return hsv2rgb(vec3(hue, saturation, line));
}
