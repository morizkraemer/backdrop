// Wash: one colour over the whole wall, optionally breathing
// control: pulse

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
1.0

//!PARAM level
//!DESC Level
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
1.0

//!PARAM pulse
//!DESC Breathing
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 2.0
0.0

//!PARAM depth
//!DESC Depth
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.5

//!PARAM gradient
//!DESC Side fade
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.0

vec3 visual(vec2 uv, float t) {
    float breath = 1.0 - depth * (0.5 - 0.5 * cos(t * pulse * 2.0 * PI));
    if (pulse <= 0.0) breath = 1.0;
    float edge = 1.0 - gradient * pow(abs(uv.x - 0.5) * 2.0, 1.5);
    return hsv2rgb(vec3(hue, saturation, level * breath * edge));
}
