// Black hole: a swirling accretion disk falling into the dark, with lensed stars
// control: trip

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
0.6

//!PARAM size
//!DESC Size
//!TYPE DYNAMIC float
//!MINIMUM 0.04
//!MAXIMUM 0.4
0.16

//!PARAM swirl
//!DESC Swirl
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 3.0
1.2

//!PARAM tilt
//!DESC Tilt
//!TYPE DYNAMIC float
//!MINIMUM 0.15
//!MAXIMUM 1.0
0.35

//!PARAM trip
//!DESC Trippy
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.7

//!PARAM hue
//!DESC Colour
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.05

//!PARAM glow
//!DESC Glow
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 2.0
1.0

vec3 visual(vec2 uv, float t) {
    vec2 p = (uv - 0.5) * vec2(ASPECT, 1.0);
    float rs = size;
    float r = length(p);

    // Background stars, bent around the hole: light from behind gets pulled
    // into a ring, so the sky near the edge looks stretched and doubled
    float bend = rs * rs * 1.6 / max(r * r, 1e-4);
    vec2 sky = p * (1.0 - bend) * 9.0;
    float ang = t * 0.02;
    sky = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * sky;
    vec2 cell = floor(sky * 3.0);
    vec2 f = fract(sky * 3.0) - 0.5;
    float h = hash21(cell);
    float stars = h > 0.93 ? smoothstep(0.08, 0.0, length(f - (vec2(hash21(cell + 1.7), hash21(cell + 4.1)) - 0.5) * 0.6)) : 0.0;
    vec3 col = stars * vec3(0.8, 0.85, 1.0) * smoothstep(rs * 1.2, rs * 3.0, r);

    // Accretion disk, seen at a tilt, spiralling inwards faster near the hole
    vec2 pd = vec2(p.x, p.y / tilt);
    float rd = length(pd);
    float ad = atan(pd.y, pd.x);
    float fall = swirl * rs / max(rd - rs * 0.9, 0.03);
    float a2 = ad + fall + t * 0.8;
    vec2 q = vec2(cos(a2), sin(a2)) * 2.5 + vec2(log(max(rd, 1e-3)) * 3.0 - t * 1.2, t * 0.2);
    float gas = fbm(q * 1.4 + fbm(q * 2.0 + t * 0.1) * 1.5);
    float band = smoothstep(rs * 1.1, rs * 1.6, rd) * exp(-max(rd - rs * 1.6, 0.0) * 4.0 / max(rs * 6.0, 0.1));
    float heat = clamp(1.0 - (rd - rs) / (rs * 5.0), 0.0, 1.0);
    // Hot white-gold near the hole, cooling to orange and red outwards;
    // "trippy" cycles the colours through rings and over time
    float tripHue = trip * (gas * 0.6 + log(max(rd, 1e-3)) * 0.5 - t * 0.08 + 0.15 * sin(log(max(rd, 1e-3)) * 18.0 - t * 3.0));
    vec3 disk = hsv2rgb(vec3(hue + 0.06 * (1.0 - heat) + tripHue, mix(0.9, 0.25, heat * heat), 1.0));
    float bright = band * (0.25 + 1.4 * gas * gas) * (0.6 + 1.2 * heat);
    // The near side of the disk crosses in front of the hole
    float front = step(0.0, p.y);
    col += disk * bright * glow;

    // Photon ring: a thin bright halo hugging the horizon, plus the lensed
    // back of the disk arching over the top
    float ring = exp(-pow((r - rs * 1.12) / (rs * 0.05), 2.0));
    float arc = exp(-pow((r - rs * 1.35) / (rs * 0.18), 2.0)) * (0.4 + 0.6 * gas) * smoothstep(0.2, -0.6, p.y / max(r, 1e-3));
    vec3 ringCol = hsv2rgb(vec3(hue + 0.03 + tripHue * 0.5, 0.35, 1.0));
    col += ringCol * (ring * 1.5 + arc * 0.9) * glow;

    // The event horizon swallows everything behind it; the disk's near side stays in front
    float hole = smoothstep(rs * 0.98, rs * 1.04, r);
    vec3 nearDisk = disk * bright * glow * front * step(rd, rs * 4.0) * (1.0 - hole) * step(rs * 1.1, rd);
    col = col * hole + nearDisk;
    return col;
}
