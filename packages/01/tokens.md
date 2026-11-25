# Package 01: tokens

What DesignKit needs, from the greenhouse package ("The greenhouse", "Talk and the composer", "The map", "Type, colour and hand-drawn touches", "Motion values"). The prototype `TagZ4UKT9dZB6hCM53BcbS` holds the exact recipes. DesignKit is the only place these live; views use the names.

## Colour
| Name | Day | Night |
| --- | --- | --- |
| `ink` | #173E40 | #F1F5EC |
| `inkSoft` | ink at 66% | ink at 72% |
| `inkFaint` | ink at 42% | ink at 45% |
| `glassFill` | white at 38% | white at 8% |
| `glassEdge` | white at 75% | white at 22% |
| `base` | #EEF3E8 | #0A1712 |
| `apricot` | #F2B18D / #E3936B (send, dots, underlines) | same |
| `rust` | #C9622E (mic while listening, voice line) | same |
| `youCardTint` | #F2B18D at 30% (your cards in a thread) | same |

Kind colours (labels and the colour tick; the map lines are deferred): How I mean things #2F7F73, What feels like care #E3936B, How to bring something up with me #8E7CC3, What lands hard #9A6A86, When it gets heated #C9A24A, Coming back after #6FA39A, What matters to me #3F6E8C, Other things about me #8A9A96.

Night follows the iPhone's appearance setting (the Appearance override lives in Settings, deferred).

## Greenhouse and curtain
| Name | Value |
| --- | --- |
| `greenhouseLayers` | Three pre-blurred images per mode (far 18 pt, middle 11 pt, near 7 pt), 570 × 884 pt at 3x, rendered once from the prototype's `paintGreenhouse` |
| `layerFactor` | far −0.55, middle −0.20, near +0.35, lights +0.55 |
| `camera` | Talk 0, You +60 pt, People and Thread −60 pt |
| `curtain` | blur 16 pt, saturation 1.1; tint day white 26% / 8% / 30%, night #08140F 30% / 18% / 55% (top / middle / bottom) |
| `dayLight` | top glow #FFFCEC at 95%, 70% × 30%; bands at 105°, 16%, drift 40 pt over 18 s |
| `nightLight` | top glow #FFC48C at 55%; nine lamps #FFE2A8 to #FFB560, breathing 6% over 5–8 s |
| `sway` | middle and near 0.6° and 4 pt, over 11 s and 8 s |
| `grain` | the faint paper grain over everything |

## The bar and glass
| Name | Value |
| --- | --- |
| `bar` | 12 pt from the sides, 24 pt from the bottom, radius 28 pt, 56 pt tall empty, +24 pt per line up to 4 lines |
| `glass` | blur 26 pt, saturation 1.8, brightness 1.05; fill white 52% to 20% (night 13% to 4%); 1.5 pt bright top edge; shadow y 22, blur 40, spread −16, ink at 38% |
| `send` | 40 pt apricot drop, #F8CBAE to #EFA57F, white highlight, warm shadow |
| `listeningLamp` | 230 × 120 pt glow, ±90 pt over 3.4 s, scale 0.8–1.1, opacity 0.35–1 |
| `card` | radius 22–26 pt, max 84% wide in a thread |
| `row` | radius 22 pt, 10 pt apart, 18 pt from the sides, padding 14 × 16 pt |
| `ring` | 44 pt, 1.8 pt stroke in the person's colour, hand-drawn |
| `dot` | 8 pt apricot with a soft halo |
| `edgeLight` | 3 pt, 250 pt from top and bottom, 5 pt from the edge, 60%; left in teal, apricot, lilac; right glassy white |
| `minTarget` | 44 pt |

## Type (Manrope only; Dynamic Type up to AX5)
| Name | Weight and size |
| --- | --- |
| `greeting` | 200, 32 pt, tracking −0.02 em |
| `heading` | 200, 28 pt |
| `threadName` | 300, 24 pt |
| `reply` | 300, 17 pt |
| `cardWords` | 300, 19–20 pt (kenning card 20 pt) |
| `message` | 400, 16.5 pt |
| `rowName` | 700, 17 pt |
| `rowLine` | 300, 14.5 pt |
| `label` | 500–600, 11–14.5 pt |
| `caps` | 700–800, 10–11 pt, tracking 0.08–0.14 em |

Nothing under 16 pt uses weight 200 or 300. All text 4.5:1 over the glass in both modes.

## Hand-drawn
One stroke, `sk()` from the prototype, ported as is: resample every 5 pt, two slow sine waves, amplitude 0.75 pt, seeded so each mark is the same every time. Apricot 1.6–1.8 pt, or the kind or person colour. Package 01 uses it for the greeting underline, rings, insight underlines, the kenning card underline, the voice line and the knot.

## Motion
| Moment | Duration | Curve |
| --- | --- | --- |
| Camera settles | 1.4 s | (0.22, 0.9, 0.2, 1) |
| Layer settles after a pull | 0.8 s (opacity 0.6 s) | (0.2, 0.9, 0.2, 1) |
| Pull progress | distance ÷ 260 pt, eased 1 − (1 − p)²; arriving p^1.4, leaving (1 − p)^2.2; commit past 90 pt | |
| People rows arrive | 0.7 s each, from +80 pt, 50 ms apart | (0.2, 0.95, 0.25, 1.05) |
| Thread cards rise | 0.8 s each, from +60 pt, 80 ms apart | (0.2, 0.95, 0.25, 1.05) |
| Messages and replies appear | 0.6–0.8 s, from +24 pt with a 6 pt blur | (0.2, 0.9, 0.2, 1) |
| A card rises | 0.5 s, from +16 pt | (0.2, 0.9, 0.2, 1) |
| Kept for you | fades in, gone after 3.2 s | |
| Edge lights, first launch | 2.4 s × 3 | ease in out |
| Waiting knot | after 300 ms, at least 500 ms, replaced after 10 s | |
| Insight pause | 1.5 s after the last change | |
| Reduce Motion | cross-fade 0.2 s; no loops; the camera jumps | |

Pause sway and lamp loops after 10 s idle and in Low Power Mode. Hold 120 fps while pulling and 60 fps at rest on an iPhone 13.
