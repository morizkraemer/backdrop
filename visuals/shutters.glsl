// Shutters: slats opening and closing like venetian blinds, in a wave across the wall
// control: wave
// category: Minimal

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
1.0

//!PARAM slats
//!DESC Slats
//!TYPE DYNAMIC int
//!MINIMUM 2
//!MAXIMUM 48
16

//!PARAM wave
//!DESC Wave
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.5

//!PARAM sideways
//!DESC Sideways
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
    float n = float(slats);
    // Vertical slats by default, horizontal ones sideways
    float x = sideways == 1 ? uv.y : uv.x;
    float i = min(floor(x * n), n - 1.0);
    float local = fract(x * n);
    // Each slat turns a little after the one before it: Wave 1 is one full wave across the wall
    float open = 0.5 + 0.5 * sin(t * 2.0 - (i + 0.5) / n * wave * 6.2832);
    float lit = step(abs(local - 0.5) * 2.0, open);
    return hsv2rgb(vec3(hue, saturation, lit));
}
