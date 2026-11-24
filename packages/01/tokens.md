# Package 01: tokens

What DesignKit needs for these screens, from the frozen V3 design (package "Materials and tokens", remaining screens "Secondary ink", flows "Motion spec" and "Waiting symbol"). DesignKit is the only place these values live; screens use the names.

## Colour
| Name | Light | Dark | Used for |
| --- | --- | --- | --- |
| `ground` | #F4EDE3 | #0F2527 | Screen background |
| `paper` | #FFF9EF | #1E4245 | People's words (Talk words, Write field, cards, kennings, gift) |
| `ink` | #173E40 | #FFF2DE | Main text |
| `inkSecondary` | #335455 | #CBD3CC | Supporting text, the waiting envelope, Home's F5 line. Solid, never a transparent ink |
| `glass` | white 55%, blur 24, hairline white 85% | white 8%, blur 24, hairline white 16% | App surfaces: bars, sheets, the app's lines |
| `glassDashed` | `glass` with a dashed hairline | same | Anything not yet the person's: suggestion cards, the Suggestions row, the "From what you said" card |
| `apricot` | #F2B18D | #F2B18D | Only `write.send`, `invitePreview.send`, `card.reply` |
| `underlineApricot` | #E89B72 | #E89B72 | Hand-drawn underline under a part a note is about |
| `underlineGreen` | #7FB8A4 | #7FB8A4 | Hand-drawn underline under a Talk receipt quote |
| `light` | green #7FB8A4, rose #E7A08C, amber #E9BE8E, lilac #9FA9C9, softened | same at lower opacity | The calm light behind Home, You and Talk only |

The brand teal #173E40 and cream #FFF2DE are already in `design/v3/brand`.

## Type
| Name | Font | Size | Used for |
| --- | --- | --- | --- |
| `words` | Newsreader 400 | 19–23 pt, Dynamic Type | People's words: always the largest text on screen (V3 rule 2) |
| `heading` | Manrope SemiBold | Dynamic Type title styles | Screen titles, the wordmark |
| `ui` | System | Dynamic Type body and footnote | The app's own small text |

Fonts are in `design/v3/fonts`. Full Dynamic Type everywhere.

## Shape and size
| Name | Value |
| --- | --- |
| `cardRadius` | 20 pt |
| `sheetRadius` | 28 pt |
| `buttonHeight` | 52 pt |
| `buttonBottomGap` | 16 pt above the home indicator |
| `minTarget` | 44 pt |
| `waitEnvelopeWidth` | 30 pt (16 pt inside a card row), stroke 1.4 pt |

A spacing scale is DesignKit's own (setup task A5); package 01 adds no value to it.

## Motion
| Name | Value |
| --- | --- |
| `placeSettle` | Spring, response 0.30 s, damping 1.0; finish past 50% of width or 300 pt/s |
| `actRise` / `actClose` | 320 ms ease-out / 260 ms ease-in |
| `fold` | 320 ms ease-out, then `actClose` |
| `waitDelay` / `waitMin` / `waitCycle` / `waitGiveUp` | 300 ms / 500 ms / 1.6 s (flap to 45% depth) / 10 s |
| `insightPause` | 1.5 s after the last change |
| `reduceMotionFade` | 200 ms cross-fade |
| `lightCycle` | 42–60 s; paused off screen, in Low Power Mode and with Reduce Motion |
