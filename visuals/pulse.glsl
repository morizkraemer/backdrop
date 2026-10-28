// Pulse: the whole wall hitting on the beat, like a blinder
// Patterns: 0 single hit, 1 double hit, 2 swell, 3 left/right, 4 thirds
// controls: pattern, decay, floor_
// category: Minimal

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

//!PARAM decay
//!DESC Decay
//!TYPE DYNAMIC float
//!MINIMUM 0.02
//!MAXIMUM 1.0
0.3

//!PARAM floor_
//!DESC Floor
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 0.5
0.0

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
    float beat = t * 2.0;            // two hits per second at speed 1
    float ph = fract(beat);
    float k = floor(beat);
    float hit = exp(-ph / decay);
    float level;
    if (pattern == 1) {
        float ph2 = fract(beat * 2.0);
        level = mod(k, 2.0) < 1.0 ? exp(-ph2 / (decay * 0.5)) : 0.0;
    } else if (pattern == 2) {
        level = smoothstep(0.0, 1.0, ph) * (1.0 - smoothstep(0.92, 1.0, ph));
    } else if (pattern == 3) {
        float side = uv.x < 0.5 ? 0.0 : 1.0;
        level = mod(k, 2.0) == side ? hit : 0.0;
    } else if (pattern == 4) {
        float third = min(floor(uv.x * 3.0), 2.0);
        level = mod(k, 3.0) == third ? hit : 0.0;
    } else {
        level = hit;
    }
    return hsv2rgb(vec3(hue, saturation, max(level, floor_)));
}
