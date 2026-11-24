# Bridge offline evaluation

- Variant: `you-blame-strict`
- Gold: 2026-11-21-v2-ceo; 48/48 fixed fictional drafts
- Engine model: claude-sonnet-5-5
- Cache: 55 hit(s), 0 live model call(s)
- Elapsed: 10 ms

## Metrics

| metric | result | delta vs baseline |
|---|---:|---:|
| flaw caught | 33/36 | (-2)|
| false alarms | 6/12 | (-1)|
| quiet when expected | 6/12 | (+1)|
| belief link right | 25/36 | (+0)|
| wrong links | 34/48 | (-3)|
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
| sarcasm | 5 | 0 | 0 | 100% | 100% |
| vague_ask | 9 | 16 | 1 | 36% | 90% |
| you_blame | 6 | 0 | 2 | 100% | 75% |

## Judge

- Calibration agreement with the 40 fixed labels: 39/40 (98%).
- Wording/law rows clean: 41/48.

## Confusion list

### p01-01

- Draft: You never notice the stuff I do around here. I'm always the one remembering the dentist, the bins, your mum's birthday.
- Gold: {"frictions":["absolute","you_blame"],"belief":"p01-b7","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":["absolute","you_blame","absolute","vague_ask"],"activated":["p01-b7","p01-b1"],"lands_on":["p02-p3"],"safety":"none","note":["Always and never tend to be heard as a verdict on the whole person, so the one time you mean can get lost.","A line about what they do tends to be heard as blame, and invites a defence instead of an answer.","Always and never tend to be heard as a verdict on the whole person, so the one time you mean can get lost.","This says something has to change; it does not yet say what you want them to do.","Making a home together means sharing the invisible work","I earn my place by noticing what everyone else needs first"]}
- Why: wrong belief link

### p01-02

- Draft: Oh great, you booked the late shift again. Love that for our Friday.
- Gold: {"frictions":["sarcasm"],"belief":"p01-b4","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":["sarcasm","sarcasm","vague_ask"],"activated":["p01-b4","p01-b2","p01-b5"],"lands_on":["p02-p3"],"safety":"none","note":["Words that mean their opposite often land as a jab, so the point underneath can be missed.","Words that mean their opposite often land as a jab, so the point underneath can be missed.","This says something has to change; it does not yet say what you want them to do.","Work is worth protecting, but it cannot take every evening","A promise matters most in the ordinary follow-through"]}
- Why: wrong belief link

### p01-04

- Draft: You don't care if I'm wiped out, you just assume I'll cook.
- Gold: {"frictions":["mind_reading","you_blame"],"belief":"p01-b1","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":["mind_reading","you_blame","mind_reading","you_blame","vague_ask"],"activated":["p01-b7","p01-b5","p01-b1"],"lands_on":["p02-p3"],"safety":"none","note":["A line about what they feel or mean tends to be heard as a claim about them, and invites a correction instead of an answer.","A line about what they do tends to be heard as blame, and invites a defence instead of an answer.","A line about what they feel or mean tends to be heard as a claim about them, and invites a correction instead of an answer.","A line about what they do tends to be heard as blame, and invites a defence instead of an answer.","This says something has to change; it does not yet say what you want them to do.","Making a home together means sharing the invisible work","I trust a direct request more than a carefully dropped hint"]}
- Why: wrong belief link

### p01-05

- Draft: The money for the trip, the car service you forgot, and last month's bill too. It's all on me.
- Gold: {"frictions":["blame_stack"],"belief":"p01-b7","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":["blame_stack","vague_ask"],"activated":["p01-b7","p01-b2"],"lands_on":["p02-p3"],"safety":"none","note":["Several old moments at once tend to be heard as a verdict, and the one that matters today can get lost in the pile.","This says something has to change; it does not yet say what you want them to do.","Making a home together means sharing the invisible work","A promise matters most in the ordinary follow-through"]}
- Why: wrong belief link

### p01-06

- Draft: Everyone could tell something was off with you at dinner, so just tell me.
- Gold: {"frictions":["mind_reading","demand"],"belief":"p01-b5","receiver_reading":"p02-p3","expect":"flag+lands"}
- Engine: {"frictions":["demand","mind_reading"],"activated":["p01-b5","p01-b1"],"lands_on":["p02-p3"],"safety":"none","note":["An order tends to be heard as something to push back on; a request tends to be heard as something to answer.","A line about what they feel or mean tends to be heard as a claim about them, and invites a correction instead of an answer.","I trust a direct request more than a carefully dropped hint","I earn my place by noticing what everyone else needs first"]}
- Why: wrong belief link

### p01-07

- Draft: I'll be home by seven, can you leave the porch light on?
- Gold: {"frictions":[],"belief":"none","receiver_reading":null,"expect":"quiet"}
- Engine: {"frictions":[],"activated":["p01-b5"],"lands_on":[],"safety":"none","note":["I trust a direct request more than a carefully dropped hint"]}
- Why: false alarm on quiet gold

### p03-01

- Draft: It's fine, honestly, I just thought maybe the sofa was something we might have looked at together, but it's fine.
- Gold: {"frictions":["vague_ask"],"belief":"p03-b6","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":["vague_ask"],"activated":["p03-b7","p03-b6"],"lands_on":["p04-p3"],"safety":"none","note":["This says something has to change; it does not yet say what you want them to do.","A shared space works when both people can leave their mark on it","I soften a hard point until it risks disappearing"]}
- Why: wrong belief link

### p03-02

- Draft: Sure, pick the paint without me too, why not.
- Gold: {"frictions":["sarcasm"],"belief":"p03-b7","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":["sarcasm","vague_ask"],"activated":["p03-b7","p03-b6"],"lands_on":["p04-p3"],"safety":"none","note":["Words that mean their opposite often land as a jab, so the point underneath can be missed.","This says something has to change; it does not yet say what you want them to do.","A shared space works when both people can leave their mark on it","I soften a hard point until it risks disappearing"]}
- Why: wrong belief link

### p03-04

- Draft: Maybe at some point, if you ever have a minute, we could possibly talk about how things are going.
- Gold: {"frictions":["vague_ask"],"belief":"p03-b1","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":["vague_ask"],"activated":["p03-b6","p03-b1"],"lands_on":["p04-p3"],"safety":"none","note":["This says something has to change; it does not yet say what you want them to do.","I soften a hard point until it risks disappearing","I protect closeness by making room before I ask for it"]}
- Why: wrong belief link

### p03-05

- Draft: You've obviously decided my opinion doesn't count.
- Gold: {"frictions":["mind_reading"],"belief":"p03-b2","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":["mind_reading","vague_ask"],"activated":["p03-b7","p03-b2"],"lands_on":["p04-p3"],"safety":"none","note":["A line about what they feel or mean tends to be heard as a claim about them, and invites a correction instead of an answer.","This says something has to change; it does not yet say what you want them to do.","A shared space works when both people can leave their mark on it","Being understood matters more to me than winning an argument"]}
- Why: wrong belief link

### p03-08

- Draft: I loved the photo you sent of the class garden.
- Gold: {"frictions":[],"belief":"none","receiver_reading":null,"expect":"quiet"}
- Engine: {"frictions":[],"activated":["p03-b8"],"lands_on":[],"safety":"none","note":["Objects become meaningful when someone tells the ordinary story around them"]}
- Why: false alarm on quiet gold

### p05-02

- Draft: Wow, thanks for the two-hour heads-up. Super helpful.
- Gold: {"frictions":["sarcasm"],"belief":"p05-b4","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":["sarcasm","vague_ask"],"activated":["p05-b5","p05-b3","p05-b2"],"lands_on":["p06-p3"],"safety":"none","note":["Words that mean their opposite often land as a jab, so the point underneath can be missed.","This says something has to change; it does not yet say what you want them to do.","I trust people who do the small thing they said they would.","A good life needs unscheduled hours in it."]}
- Why: wrong belief link

### p05-04

- Draft: I'm sick of always being the one who rearranges everything.
- Gold: {"frictions":["heat","absolute"],"belief":"p05-b2","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":["heat","absolute","vague_ask"],"activated":["p05-b8","p05-b5"],"lands_on":[],"safety":"none","note":["A word like hate tends to be heard as the size of the message, so the point underneath can get lost behind it.","Always and never tend to be heard as a verdict on the whole person, so the one time you mean can get lost.","This says something has to change; it does not yet say what you want them to do.","I can change a plan without treating it as a failure.","I trust people who do the small thing they said they would."]}
- Why: wrong belief link

### p05-05

- Draft: Send me the details now. I need to answer by tonight.
- Gold: {"frictions":["demand"],"belief":"p05-b4","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":["demand"],"activated":["p05-b2","p05-b5"],"lands_on":[],"safety":"none","note":["An order tends to be heard as something to push back on; a request tends to be heard as something to answer.","Asking plainly is kinder than hoping someone guesses.","I trust people who do the small thing they said they would."]}
- Why: wrong belief link

### p05-07

- Draft: I can bring the poster board on Thursday.
- Gold: {"frictions":[],"belief":"none","receiver_reading":null,"expect":"quiet"}
- Engine: {"frictions":[],"activated":["p05-b5"],"lands_on":[],"safety":"none","note":["I trust people who do the small thing they said they would."]}
- Why: false alarm on quiet gold

### p07-01

- Draft: As I have said before, I would appreciate being consulted prior to plans being made on my behalf.
- Gold: {"frictions":["demand"],"belief":"p07-b6","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":[],"activated":["p07-b4","p07-b6","p07-b2"],"lands_on":["p08-p3"],"safety":"none","note":["I ask for details before I agree to family plans.","I become formal when I am hurt."]}
- Why: missed gold flaw

### p07-02

- Draft: You always decide for everyone and then expect us to fall in line.
- Gold: {"frictions":["absolute","you_blame"],"belief":"p07-b1","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":["absolute","you_blame","mind_reading","you_blame"],"activated":["p07-b4","p07-b3"],"lands_on":["p08-p3"],"safety":"none","note":["Always and never tend to be heard as a verdict on the whole person, so the one time you mean can get lost.","A line about what they do tends to be heard as blame, and invites a defence instead of an answer.","A line about what they feel or mean tends to be heard as a claim about them, and invites a correction instead of an answer.","A line about what they do tends to be heard as blame, and invites a defence instead of an answer.","I ask for details before I agree to family plans.","Making room for a story is a form of respect."]}
- Why: wrong belief link

### p07-03

- Draft: About Christmas. We should probably sort it.
- Gold: {"frictions":["vague_ask"],"belief":"p07-b4","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":["vague_ask"],"activated":["p07-b4","p07-b1"],"lands_on":["p08-p3"],"safety":"none","note":["This says something has to change; it does not yet say what you want them to do.","I ask for details before I agree to family plans.","I keep the peace so nobody has to choose sides."]}
- Why: wrong belief link

### p07-04

- Draft: You're being stubborn about Mum's birthday, as usual.
- Gold: {"frictions":["character","absolute"],"belief":"p07-b2","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":["character","absolute","vague_ask"],"activated":["p07-b3"],"lands_on":["p08-p3"],"safety":"none","note":["A word about who someone is tends to be heard before what they did, so the moment itself can get lost.","Always and never tend to be heard as a verdict on the whole person, so the one time you mean can get lost.","This says something has to change; it does not yet say what you want them to do.","Making room for a story is a form of respect."]}
- Why: wrong belief link

### p07-05

- Draft: There's the dinner you cancelled, the money for the gift, and the way you spoke to Dad. I'm done.
- Gold: {"frictions":["blame_stack","heat"],"belief":"p07-b5","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":["blame_stack","vague_ask"],"activated":["p07-b2","p07-b6","p07-b5"],"lands_on":["p08-p3"],"safety":"none","note":["Several old moments at once tend to be heard as a verdict, and the one that matters today can get lost in the pile.","This says something has to change; it does not yet say what you want them to do.","I can love my family and still set a limit.","I become formal when I am hurt."]}
- Why: wrong belief link

### p07-06

- Draft: I'm not going to keep asking. You know what I need.
- Gold: {"frictions":["vague_ask","mind_reading"],"belief":"p07-b2","receiver_reading":"p08-p3","expect":"flag+lands"}
- Engine: {"frictions":["mind_reading","vague_ask"],"activated":["p07-b6","p07-b2"],"lands_on":["p08-p3"],"safety":"none","note":["A line about what they feel or mean tends to be heard as a claim about them, and invites a correction instead of an answer.","This says something has to change; it does not yet say what you want them to do.","I become formal when I am hurt.","I can love my family and still set a limit."]}
- Why: wrong belief link

### p07-08

- Draft: Thank you for listening to Grandad's story again, it meant a lot to him.
- Gold: {"frictions":[],"belief":"none","receiver_reading":null,"expect":"quiet"}
- Engine: {"frictions":[],"activated":["p07-b3"],"lands_on":[],"safety":"none","note":["Making room for a story is a form of respect."]}
- Why: false alarm on quiet gold

### p09-01

- Draft: You never update the tracker, so I'm left guessing every single morning.
- Gold: {"frictions":["absolute","you_blame"],"belief":"p09-b1","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":["absolute","you_blame","absolute","vague_ask"],"activated":["p09-b3","p09-b7","p09-b5"],"lands_on":["p10-p3"],"safety":"none","note":["Always and never tend to be heard as a verdict on the whole person, so the one time you mean can get lost.","A line about what they do tends to be heard as blame, and invites a defence instead of an answer.","Always and never tend to be heard as a verdict on the whole person, so the one time you mean can get lost.","This says something has to change; it does not yet say what you want them to do.","A changed plan is workable once I can see the next two steps.","Care lands for me when someone remembers the small practical thing."]}
- Why: wrong belief link

### p09-02

- Draft: Love finding out about the deadline change from the client. Great teamwork.
- Gold: {"frictions":["sarcasm"],"belief":"p09-b3","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":["sarcasm","vague_ask"],"activated":["p09-b7","p09-b5","p09-b3"],"lands_on":["p10-p3"],"safety":"none","note":["Words that mean their opposite often land as a jab, so the point underneath can be missed.","This says something has to change; it does not yet say what you want them to do.","Care lands for me when someone remembers the small practical thing.","I trust a direct request more than a carefully dropped hint."]}
- Why: wrong belief link

### p09-04

- Draft: Your drafts are sloppy and it makes us look bad.
- Gold: {"frictions":["character","contempt"],"belief":"p09-b5","receiver_reading":"p10-p3","expect":"flag+lands"}
- Engine: {"frictions":["character","vague_ask"],"activated":["p09-b1"],"lands_on":["p10-p3"],"safety":"none","note":["A word about who someone is tends to be heard before what they did, so the moment itself can get lost.","This says something has to change; it does not yet say what you want them to do.","I matter at work when I make the messy parts easier for other people."]}
- Why: wrong belief link

### p09-05

- Draft: Just get it to me by five.
- Gold: {"frictions":["demand"],"belief":"p09-b4","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":["demand"],"activated":["p09-b5"],"lands_on":["p10-p3"],"safety":"none","note":["An order tends to be heard as something to push back on; a request tends to be heard as something to answer.","I trust a direct request more than a carefully dropped hint."]}
- Why: wrong belief link

### p09-06

- Draft: I said yes to covering Friday, but honestly I can't, and you should have known that.
- Gold: {"frictions":["mind_reading"],"belief":"p09-b4","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":["mind_reading","vague_ask"],"activated":["p09-b4","p09-b5","p09-b2"],"lands_on":["p10-p3"],"safety":"none","note":["A line about what they feel or mean tends to be heard as a claim about them, and invites a correction instead of an answer.","This says something has to change; it does not yet say what you want them to do.","I say yes too quickly when someone sounds pressed for time.","I trust a direct request more than a carefully dropped hint."]}
- Why: wrong belief link

### p09-08

- Draft: Your sketch made the brief click for me, thank you.
- Gold: {"frictions":[],"belief":"none","receiver_reading":null,"expect":"quiet"}
- Engine: {"frictions":[],"activated":["p09-b1"],"lands_on":[],"safety":"none","note":["I matter at work when I make the messy parts easier for other people."]}
- Why: false alarm on quiet gold

### p11-02

- Draft: You always make it a big thing.
- Gold: {"frictions":["absolute","you_blame"],"belief":"p11-b7","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":["absolute","you_blame"],"activated":["p11-b7","p11-b6"],"lands_on":["p12-p3"],"safety":"none","note":["Always and never tend to be heard as a verdict on the whole person, so the one time you mean can get lost.","A line about what they do tends to be heard as blame, and invites a defence instead of an answer.","Sharing ordinary time feels more honest than making a big plan.","When a room gets intense, I go quiet before I leave."]}
- Why: wrong belief link

### p11-03

- Draft: Can't do Thursday. Whatever works.
- Gold: {"frictions":["vague_ask"],"belief":"p11-b8","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":[],"activated":["p11-b8","p11-b7"],"lands_on":[],"safety":"none","note":["I keep one evening each week with no plans so I can reset.","Sharing ordinary time feels more honest than making a big plan."]}
- Why: missed gold flaw

### p11-04

- Draft: You talk too much when I'm trying to think.
- Gold: {"frictions":["you_blame","character"],"belief":"p11-b4","receiver_reading":"p12-p3","expect":"flag+lands"}
- Engine: {"frictions":[],"activated":["p11-b3","p11-b4"],"lands_on":["p12-p3"],"safety":"none","note":["My own pace is still a real pace.","I need the question to be simple before I answer it."]}
- Why: missed gold flaw

### p11-05

- Draft: Stop checking on me.
- Gold: {"frictions":["demand"],"belief":"p11-b2","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":["demand"],"activated":["p11-b3","p11-b8"],"lands_on":["p12-p3"],"safety":"none","note":["An order tends to be heard as something to push back on; a request tends to be heard as something to answer.","My own pace is still a real pace.","I keep one evening each week with no plans so I can reset."]}
- Why: wrong belief link

### p11-06

- Draft: Sure, another dinner party. Can't wait.
- Gold: {"frictions":["sarcasm"],"belief":"p11-b7","receiver_reading":null,"expect":"flag+link"}
- Engine: {"frictions":["sarcasm","vague_ask"],"activated":["p11-b8","p11-b7"],"lands_on":["p12-p3"],"safety":"none","note":["Words that mean their opposite often land as a jab, so the point underneath can be missed.","This says something has to change; it does not yet say what you want them to do.","I keep one evening each week with no plans so I can reset.","Sharing ordinary time feels more honest than making a big plan."]}
- Why: wrong belief link

### p11-08

- Draft: Good game Sunday. Thanks for the ride.
- Gold: {"frictions":[],"belief":"none","receiver_reading":null,"expect":"quiet"}
- Engine: {"frictions":[],"activated":["p11-b2","p11-b7"],"lands_on":[],"safety":"none","note":["I can let a friend help without turning it into a debt.","Sharing ordinary time feels more honest than making a big plan."]}
- Why: false alarm on quiet gold


## Six examples

### p01-01

Before: You never notice the stuff I do around here. I'm always the one remembering the dentist, the bins, your mum's birthday.
After: Always and never tend to be heard as a verdict on the whole person, so the one time you mean can get lost. | A line about what they do tends to be heard as blame, and invites a defence instead of an answer. | Always and never tend to be heard as a verdict on the whole person, so the one time you mean can get lost. | This says something has to change; it does not yet say what you want them to do. | Making a home together means sharing the invisible work | I earn my place by noticing what everyone else needs first
Gold: {"frictions":["absolute","you_blame"],"belief":"p01-b7","receiver_reading":null,"expect":"flag+link"}

### p01-02

Before: Oh great, you booked the late shift again. Love that for our Friday.
After: Words that mean their opposite often land as a jab, so the point underneath can be missed. | Words that mean their opposite often land as a jab, so the point underneath can be missed. | This says something has to change; it does not yet say what you want them to do. | Work is worth protecting, but it cannot take every evening | A promise matters most in the ordinary follow-through
Gold: {"frictions":["sarcasm"],"belief":"p01-b4","receiver_reading":null,"expect":"flag+link"}

### p01-04

Before: You don't care if I'm wiped out, you just assume I'll cook.
After: A line about what they feel or mean tends to be heard as a claim about them, and invites a correction instead of an answer. | A line about what they do tends to be heard as blame, and invites a defence instead of an answer. | A line about what they feel or mean tends to be heard as a claim about them, and invites a correction instead of an answer. | A line about what they do tends to be heard as blame, and invites a defence instead of an answer. | This says something has to change; it does not yet say what you want them to do. | Making a home together means sharing the invisible work | I trust a direct request more than a carefully dropped hint
Gold: {"frictions":["mind_reading","you_blame"],"belief":"p01-b1","receiver_reading":null,"expect":"flag+link"}

### p01-05

Before: The money for the trip, the car service you forgot, and last month's bill too. It's all on me.
After: Several old moments at once tend to be heard as a verdict, and the one that matters today can get lost in the pile. | This says something has to change; it does not yet say what you want them to do. | Making a home together means sharing the invisible work | A promise matters most in the ordinary follow-through
Gold: {"frictions":["blame_stack"],"belief":"p01-b7","receiver_reading":null,"expect":"flag+link"}

### p01-06

Before: Everyone could tell something was off with you at dinner, so just tell me.
After: An order tends to be heard as something to push back on; a request tends to be heard as something to answer. | A line about what they feel or mean tends to be heard as a claim about them, and invites a correction instead of an answer. | I trust a direct request more than a carefully dropped hint | I earn my place by noticing what everyone else needs first
Gold: {"frictions":["mind_reading","demand"],"belief":"p01-b5","receiver_reading":"p02-p3","expect":"flag+lands"}

### p01-07

Before: I'll be home by seven, can you leave the porch light on?
After: I trust a direct request more than a carefully dropped hint
Gold: {"frictions":[],"belief":"none","receiver_reading":null,"expect":"quiet"}
