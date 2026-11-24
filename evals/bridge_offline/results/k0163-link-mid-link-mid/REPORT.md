# Bridge offline evaluation

- Variant: `link-mid`
- Gold: 2026-11-21-v2-ceo; 48/48 fixed fictional drafts
- Engine model: claude-sonnet-5-5
- Cache: 53 hit(s), 0 live model call(s)
- Elapsed: 10 ms

## Metrics

| metric | result | delta vs baseline |
|---|---:|---:|
| flaw caught | 33/36 | (-2)|
| false alarms | 2/12 | (-5)|
| quiet when expected | 10/12 | (+5)|
| belief link right | 7/36 | (-18)|
| wrong links | 6/48 | (-31)|
| receiver reading match | 5/6 | (-1)|
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
| sarcasm | 5 | 0 | 0 | 100% | 100% |
| vague_ask | 8 | 10 | 2 | 44% | 80% |
| you_blame | 8 | 6 | 0 | 57% | 100% |

## Judge

- Calibration agreement with the 40 fixed labels: 39/40 (98%).
- Wording/law rows clean: 42/48.

## Confusion list

### p03-01

- Draft: It's fine, honestly, I just thought maybe the sofa was something we might have looked at together, but it's fine.
- Gold: {"frictions":["vague_ask"],"belief":"p03-b6","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":["vague_ask"],"activated":["p03-b7"],"lands_on":["p04-p3"],"safety":"none","note":["This says something has to change; it does not yet say what you want them to do.","A shared space works when both people can leave their mark on it"]}
- Why: wrong belief link

### p03-04

- Draft: Maybe at some point, if you ever have a minute, we could possibly talk about how things are going.
- Gold: {"frictions":["vague_ask"],"belief":"p03-b1","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":["vague_ask"],"activated":["p03-b6"],"lands_on":["p04-p3"],"safety":"none","note":["This says something has to change; it does not yet say what you want them to do.","I soften a hard point until it risks disappearing"]}
- Why: wrong belief link

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
- Engine: {"frictions":["absolute","you_blame","mind_reading","you_blame"],"activated":["p07-b4"],"lands_on":[],"safety":"none","note":["Always and never tend to be heard as a verdict on the whole person, so the one time you mean can get lost.","A line about what they do tends to be heard as blame, and invites a defence instead of an answer.","A line about what they feel or mean tends to be heard as a claim about them, and invites a correction instead of an answer.","A line about what they do tends to be heard as blame, and invites a defence instead of an answer.","I ask for details before I agree to family plans."]}
- Why: wrong belief link

### p07-08

- Draft: Thank you for listening to Grandad's story again, it meant a lot to him.
- Gold: {"frictions":[],"belief":"none","receiver_reading":null,"expect":"quiet"}
- Engine: {"frictions":[],"activated":["p07-b3"],"lands_on":[],"safety":"none","note":["Making room for a story is a form of respect."]}
- Why: false alarm on quiet gold

### p11-03

- Draft: Can't do Thursday. Whatever works.
- Gold: {"frictions":["vague_ask"],"belief":"p11-b8","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":[],"activated":[],"lands_on":[],"safety":"none","note":[]}
- Why: missed gold flaw

### p11-04

- Draft: You talk too much when I'm trying to think.
- Gold: {"frictions":["you_blame","character"],"belief":"p11-b4","receiver_reading":"p12-p3","expect":"flag+lands"}
- Engine: {"frictions":["you_blame"],"activated":[],"lands_on":[],"safety":"none","note":["A line about what they do tends to be heard as blame, and invites a defence instead of an answer."]}
- Why: receiver reading missed

### p11-08

- Draft: Good game Sunday. Thanks for the ride.
- Gold: {"frictions":[],"belief":"none","receiver_reading":null,"expect":"quiet"}
- Engine: {"frictions":[],"activated":["p11-b2"],"lands_on":[],"safety":"none","note":["I can let a friend help without turning it into a debt."]}
- Why: false alarm on quiet gold


## Six examples

### p03-01

Before: It's fine, honestly, I just thought maybe the sofa was something we might have looked at together, but it's fine.
After: This says something has to change; it does not yet say what you want them to do. | A shared space works when both people can leave their mark on it
Gold: {"frictions":["vague_ask"],"belief":"p03-b6","receiver_reading":null,"expect":"flag+link"}

### p03-04

Before: Maybe at some point, if you ever have a minute, we could possibly talk about how things are going.
After: This says something has to change; it does not yet say what you want them to do. | I soften a hard point until it risks disappearing
Gold: {"frictions":["vague_ask"],"belief":"p03-b1","receiver_reading":null,"expect":"flag+link"}

### p05-03

Before: I just feel like I'm too much lately. Anyway.
After: If I am not useful, I worry I take up too much room.
Gold: {"frictions":["vague_ask"],"belief":"p05-b1","receiver_reading":null,"expect":"flag+link"}

### p07-01

Before: As I have said before, I would appreciate being consulted prior to plans being made on my behalf.
After: I ask for details before I agree to family plans.
Gold: {"frictions":["demand"],"belief":"p07-b6","receiver_reading":null,"expect":"flag+link"}

### p07-02

Before: You always decide for everyone and then expect us to fall in line.
After: Always and never tend to be heard as a verdict on the whole person, so the one time you mean can get lost. | A line about what they do tends to be heard as blame, and invites a defence instead of an answer. | A line about what they feel or mean tends to be heard as a claim about them, and invites a correction instead of an answer. | A line about what they do tends to be heard as blame, and invites a defence instead of an answer. | I ask for details before I agree to family plans.
Gold: {"frictions":["absolute","you_blame"],"belief":"p07-b1","receiver_reading":null,"expect":"flag+link"}

### p07-08

Before: Thank you for listening to Grandad's story again, it meant a lot to him.
After: Making room for a story is a form of respect.
Gold: {"frictions":[],"belief":"none","receiver_reading":null,"expect":"quiet"}
