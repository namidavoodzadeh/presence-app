# Bridge offline evaluation

- Variant: `combo`
- Gold: 2026-11-21-v2-ceo; 48/48 fixed fictional drafts
- Engine model: claude-sonnet-5-5
- Cache: 55 hit(s), 0 live model call(s)
- Elapsed: 11 ms

## Metrics

| metric | result | delta vs baseline |
|---|---:|---:|
| flaw caught | 24/36 | (-11)|
| false alarms | 1/12 | (-6)|
| quiet when expected | 11/12 | (+6)|
| belief link right | 9/36 | (-16)|
| wrong links | 5/48 | (-32)|
| receiver reading match | 6/6 | (+0)|
| law failures | 0 | (-1)|
| errors | 0 | (+0)|

## Friction precision and recall

| kind | TP | FP | FN | precision | recall |
|---|---:|---:|---:|---:|---:|
| absolute | 8 | 0 | 0 | 100% | 100% |
| blame_stack | 2 | 0 | 0 | 100% | 100% |
| character | 3 | 0 | 1 | 100% | 75% |
| contempt | 0 | 0 | 1 | n/a | 0% |
| demand | 4 | 0 | 1 | 100% | 80% |
| heat | 1 | 0 | 1 | 100% | 50% |
| mind_reading | 6 | 2 | 0 | 75% | 100% |
| sarcasm | 4 | 0 | 1 | 100% | 80% |
| vague_ask | 0 | 0 | 10 | n/a | 0% |
| you_blame | 6 | 0 | 2 | 100% | 75% |

## Judge

- Calibration agreement with the 40 fixed labels: 39/40 (98%).
- Wording/law rows clean: 45/48.

## Confusion list

### p01-03

- Draft: We need to talk about the weekend thing.
- Gold: {"frictions":["vague_ask"],"belief":"p01-b5","receiver_reading":null,"expect":"flag"}
- Engine: {"frictions":[],"activated":[],"lands_on":[],"safety":"none","note":[]}
- Why: missed gold flaw

### p03-01

- Draft: It's fine, honestly, I just thought maybe the sofa was something we might have looked at together, but it's fine.
- Gold: {"frictions":["vague_ask"],"belief":"p03-b6","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":[],"activated":["p03-b7"],"lands_on":["p04-p3"],"safety":"none","note":["A shared space works when both people can leave their mark on it"]}
- Why: missed gold flaw

### p03-04

- Draft: Maybe at some point, if you ever have a minute, we could possibly talk about how things are going.
- Gold: {"frictions":["vague_ask"],"belief":"p03-b1","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":[],"activated":["p03-b6"],"lands_on":["p04-p3"],"safety":"none","note":["I soften a hard point until it risks disappearing"]}
- Why: missed gold flaw

### p03-06

- Draft: You know what I mean about the holidays. I'm not going to spell it out.
- Gold: {"frictions":["vague_ask"],"belief":"p03-b6","receiver_reading":"p04-p3","expect":"flag+lands"}
- Engine: {"frictions":["mind_reading"],"activated":["p03-b6"],"lands_on":["p04-p3"],"safety":"none","note":["A line about what they feel or mean tends to be heard as a claim about them, and invites a correction instead of an answer.","I soften a hard point until it risks disappearing"]}
- Why: missed gold flaw

### p05-03

- Draft: I just feel like I'm too much lately. Anyway.
- Gold: {"frictions":["vague_ask"],"belief":"p05-b1","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":[],"activated":["p05-b1"],"lands_on":[],"safety":"none","note":["If I am not useful, I worry I take up too much room."]}
- Why: missed gold flaw

### p07-01

- Draft: As I have said before, I would appreciate being consulted prior to plans being made on my behalf.
- Gold: {"frictions":["demand"],"belief":"p07-b6","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":[],"activated":["p07-b4"],"lands_on":[],"safety":"none","note":["I ask for details before I agree to family plans."]}
- Why: missed gold flaw

### p07-02

- Draft: You always decide for everyone and then expect us to fall in line.
- Gold: {"frictions":["absolute","you_blame"],"belief":"p07-b1","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":["absolute","mind_reading","you_blame"],"activated":["p07-b4"],"lands_on":["p08-p3"],"safety":"none","note":["Always and never tend to be heard as a verdict on the whole person, so the one time you mean can get lost.","A line about what they feel or mean tends to be heard as a claim about them, and invites a correction instead of an answer.","A line about what they do tends to be heard as blame, and invites a defence instead of an answer.","I ask for details before I agree to family plans."]}
- Why: wrong belief link

### p07-03

- Draft: About Christmas. We should probably sort it.
- Gold: {"frictions":["vague_ask"],"belief":"p07-b4","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":[],"activated":[],"lands_on":[],"safety":"none","note":[]}
- Why: missed gold flaw

### p07-08

- Draft: Thank you for listening to Grandad's story again, it meant a lot to him.
- Gold: {"frictions":[],"belief":"none","receiver_reading":null,"expect":"quiet"}
- Engine: {"frictions":[],"activated":["p07-b3"],"lands_on":[],"safety":"none","note":["Making room for a story is a form of respect."]}
- Why: false alarm on quiet gold

### p09-03

- Draft: Can we sync about the thing at some point?
- Gold: {"frictions":["vague_ask"],"belief":"p09-b5","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":[],"activated":[],"lands_on":["p10-p3"],"safety":"none","note":[]}
- Why: missed gold flaw

### p11-01

- Draft: Fine.
- Gold: {"frictions":["vague_ask"],"belief":"p11-b6","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":[],"activated":[],"lands_on":[],"safety":"none","note":[]}
- Why: missed gold flaw

### p11-03

- Draft: Can't do Thursday. Whatever works.
- Gold: {"frictions":["vague_ask"],"belief":"p11-b8","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":[],"activated":[],"lands_on":[],"safety":"none","note":[]}
- Why: missed gold flaw

### p11-04

- Draft: You talk too much when I'm trying to think.
- Gold: {"frictions":["you_blame","character"],"belief":"p11-b4","receiver_reading":"p12-p3","expect":"flag+lands"}
- Engine: {"frictions":[],"activated":[],"lands_on":["p12-p3"],"safety":"none","note":[]}
- Why: missed gold flaw

### p11-06

- Draft: Sure, another dinner party. Can't wait.
- Gold: {"frictions":["sarcasm"],"belief":"p11-b7","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":[],"activated":[],"lands_on":["p12-p3"],"safety":"none","note":[]}
- Why: missed gold flaw


## Six examples

### p01-03

Before: We need to talk about the weekend thing.
After: Nothing here is likely to get in the way.
Gold: {"frictions":["vague_ask"],"belief":"p01-b5","receiver_reading":null,"expect":"flag"}

### p03-01

Before: It's fine, honestly, I just thought maybe the sofa was something we might have looked at together, but it's fine.
After: A shared space works when both people can leave their mark on it
Gold: {"frictions":["vague_ask"],"belief":"p03-b6","receiver_reading":null,"expect":"flag+link"}

### p03-04

Before: Maybe at some point, if you ever have a minute, we could possibly talk about how things are going.
After: I soften a hard point until it risks disappearing
Gold: {"frictions":["vague_ask"],"belief":"p03-b1","receiver_reading":null,"expect":"flag+link"}

### p03-06

Before: You know what I mean about the holidays. I'm not going to spell it out.
After: A line about what they feel or mean tends to be heard as a claim about them, and invites a correction instead of an answer. | I soften a hard point until it risks disappearing
Gold: {"frictions":["vague_ask"],"belief":"p03-b6","receiver_reading":"p04-p3","expect":"flag+lands"}

### p05-03

Before: I just feel like I'm too much lately. Anyway.
After: If I am not useful, I worry I take up too much room.
Gold: {"frictions":["vague_ask"],"belief":"p05-b1","receiver_reading":null,"expect":"flag+link"}

### p07-01

Before: As I have said before, I would appreciate being consulted prior to plans being made on my behalf.
After: I ask for details before I agree to family plans.
Gold: {"frictions":["demand"],"belief":"p07-b6","receiver_reading":null,"expect":"flag+link"}
