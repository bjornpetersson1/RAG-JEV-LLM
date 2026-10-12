# Example draft: `nda`

A real run of `npm run query` (E6-2) on 2026-10-11, kept to show what the `nda` prompt template produces. The instruction is eval query `nda-01` from `eval/queries.yaml`; the parties are the template's fictional defaults.

```bash
npm run query -- "Sekretessavtal för en konsult som får tillgång till kunddata och affärsplaner." --template nda
```

Settings: `LLM_PROVIDER=claude-code` (the Claude Code subscription, no API key), query translator and judge `claude-haiku-5-5`, generator `claude-sonnet-5-5`, `JUDGE_IMPL=llm`, now `RERANKER=llm` (no JEV key yet, so the LLM judged, as in E5-3; its scores came from the judge cache of the E5-3 evaluation where available), default context limits. The source accuracy and flagged references below were added afterwards by running the E6-3 post-check over this draft and its submitted chunks; the run itself printed E6-2's interim line "Citations outside the submitted chunks: 0".

## Query

```text
Tags: sekretessavtal, sekretessklausul, omsesidig-sekretess, konfidentiell-information, foretagshemlighet, obehorigt-angrepp, sekretessens-varaktighet, undantag-fran-sekretess, aterlamnande-av-information, andamalsbegransning, vidareinformation, tekniskt-kunnande, kundregister, visselblasning, vite, jamkning-av-vite, skadestand-avtalsbrott, skadestand-foretagshemlighet, interimistiskt-beslut, jamkning-36-avtl, avtalstolkning, avtalets-giltighetstid, lagval-och-forum, uppdragstagares-sekretess, personuppgifter
Candidates: 30 · approved: 25 · unknown: 0 · judge calls: 0 · cache hits: 30
Submitted to the generator: 20
```

## Draft

# Sekretessavtal

## Parter

Utlämnande part: Exempelbolaget AB, org.nr 556000-0000, Storgatan 1, 111 22 Stockholm (”Utlämnande part”).

Mottagande part: Konsultfirman Berg HB, org.nr 969000-0000, Bergsvägen 3, 222 33 Lund (”Mottagande part”).

Parterna har ingått detta avtal i samband med att Mottagande part som konsult ska få tillgång till Utlämnande parts kunddata och affärsplaner för [syftet med informationsutbytet/uppdragets beskrivning].

## Definition av konfidentiell information

Med konfidentiell information avses all information om Utlämnande parts affärs- och driftförhållanden som Mottagande part får del av i samband med uppdraget, oavsett om den lämnas muntligen, skriftligen, elektroniskt eller på annat sätt, och oavsett om den är dokumenterad eller utgörs av enskilda personers kännedom. [K:879]

Till konfidentiell information hör särskilt
- kunddata, såsom kundregister, kunduppgifter, kundavtal, offerter, priser, betalningsvillkor och uppdragens art, [K:879][K:802][K:928]
- affärsplaner, marknadsplanering, prissättning och planer rörande kampanjer, [K:879]
- ekonomisk information, såsom resultatrapporter och uppgifter om kostnader och intäkter, [K:928]
- uppgifter om Utlämnande parts personal, deras kvalifikationer, arvoden och beläggning, [K:679][K:929]
- information som Utlämnande part är bunden att hålla hemlig gentemot sina egna kunder eller andra tredje män, [K:929][K:918]
- sammanställningar, anteckningar och kopior som innehåller eller bygger på sådan information.

Information ska anses konfidentiell om Utlämnande part har klargjort, eller om det med hänsyn till omständigheterna ändå står klart, att den inte får spridas utanför en viss krets. Något krav på särskild märkning ställs inte. [K:799]

## Undantag

Sekretessen gäller inte information som Mottagande part kan visa
1. är eller blir allmänt känd på annat sätt än genom Mottagande parts eller någon annan mottagares brott mot detta avtal, [K:1128][K:1129]
2. redan var känd för Mottagande part utan sekretessåtagande innan den lämnades av Utlämnande part,
3. Mottagande part lagligen har erhållit från tredje man som inte var bunden av sekretess, eller
4. självständigt har utvecklats av Mottagande part utan användning av konfidentiell information.

Mottagande part får röja konfidentiell information i den utsträckning det krävs enligt lag, domstols eller myndighets beslut. Mottagande part ska då i möjligaste mån i förväg underrätta Utlämnande part.

Detta avtal hindrar inte Mottagande part från att avslöja brott eller allvarliga missförhållanden i Utlämnande parts rörelse, i den mån sådan rätt följer av lag. [K:639][K:640]

## Användning

Mottagande part förbinder sig att
1. endast använda den konfidentiella informationen för [syftet med informationsutbytet/uppdragets beskrivning] och inte för något annat ändamål, [K:918]
2. inte röja, lämna ut eller mångfaldiga informationen till obehöriga utan Utlämnande parts skriftliga medgivande, [K:918]
3. begränsa tillgången till de anställda, delägare och underkonsulter som behöver informationen för att fullgöra uppdraget, och som har bundits av sekretessåtaganden minst lika ingripande som detta avtal, [K:918]
4. skydda informationen mot obehörig insyn med lämpliga tekniska och organisatoriska säkerhetsåtgärder, och inte överföra den till privata e-postkonton, externa servrar eller molntjänster som är utanför Utlämnande parts kontroll utan skriftligt medgivande, [K:928][K:929][K:1099]
5. inte ta del av eller kopiera information som saknar anknytning till uppdraget, [K:929]
6. omedelbart underrätta Utlämnande part om obehörig åtkomst, röjande eller annat otillåtet utnyttjande av informationen, och
7. på begäran, samt när uppdraget upphör, återlämna eller radera och förstöra all konfidentiell information och alla kopior, och på begäran skriftligen intyga att så har skett.

Mottagande part ansvarar för att personer som den släpper in i informationen följer detta avtal. Mottagande part får inte utnyttja informationen i konkurrerande verksamhet eller för att kontakta, ta över eller rekrytera Utlämnande parts kunder eller personal. [K:880][K:1020][K:802]

Mottagande part är införstådd med att informationen utgör företagshemligheter hos Utlämnande part och att ett angrepp på dem kan medföra skadeståndsansvar enligt lag. [K:145][K:146]

## Giltighetstid

Avtalet träder i kraft när det har undertecknats av båda parter och gäller under [giltighetstid/avtalstid].

Sekretessåtagandet gäller under avtalstiden och därefter i [tid för sekretess efter avtalets upphörande], eller så länge informationen utgör en företagshemlighet hos Utlämnande part om det är längre. Åtagandena i avsnittet Användning punkt 7 gäller även efter avtalets upphörande. [K:1128][K:802]

## Vite/skadestånd

Om Mottagande part bryter mot detta avtal ska Mottagande part betala ett vite om [vitesbelopp] för varje överträdelse. Vitet påverkar inte Utlämnande parts rätt till ersättning för skada som överstiger vitesbeloppet. [K:1128]

Utlämnande part har dessutom rätt till skadestånd för skada som uppkommer genom att Mottagande part uppsåtligen eller av oaktsamhet angriper en företagshemlighet som Mottagande part har fått del av i förtroende i samband med affärsförbindelsen. [K:145] Skadeståndet kan även omfatta allmänt skadestånd, där hänsyn tas till omständigheter av annan än rent ekonomisk betydelse. [K:800][K:880]

Utlämnande part får, utöver detta, vidta åtgärder för att förhindra fortsatt eller upprepad överträdelse, bland annat genom att begära att domstol förbjuder fortsatt utnyttjande eller röjande vid vite och förordnar om överlämnande eller förstöring av handlingar som innehåller konfidentiell information. [K:1520]

## Tillämplig lag och tvist

Detta avtal ska tolkas och tillämpas enligt svensk rätt.

Tvist i anledning av detta avtal ska avgöras av [allmän domstol/skiljeförfarande – forum anges av juristen], med [ort/tingsrätt] som första instans.

Utlämnande part har rätt att vid domstol väcka talan om förbud vid vite och andra åtgärder för att skydda konfidentiell information, oavsett vad som i övrigt avtalats om tvistlösning. [K:1520]

Ort och datum: [ort och datum]

För Exempelbolaget AB: [namnteckning, namnförtydligande och befattning]

För Konsultfirman Berg HB: [namnteckning, namnförtydligande och befattning]

_Detta är ett utkast framtaget som underlag och utgör inte juridisk rådgivning._

## Sources, citations and timing

```text
Sources used (18):
  [K:879] AD 2010 nr 27, Domskäl, Allmänt skadestånd för brott mot lagen om skydd för företagshemligheter, del 1/2
  [K:802] AD 2003 nr 21, Domskäl, del 6/17
  [K:928] AD 2010 nr 90, Inledning, Överföring och radering av dokument, del 1/5
  [K:679] AD 1998 nr 80, Domskäl, del 7/7
  [K:929] AD 2010 nr 90, Inledning, Överföring och radering av dokument, del 2/5
  [K:918] AD 2010 nr 90, Inledning, Sekretess hos bolaget, del 1/3
  [K:799] AD 2003 nr 21, Domskäl, del 3/17
  [K:1128] AD 2016 nr 21, Domskäl, Har ROL Retail en motfordran som ska kvittas?, del 1/3
  [K:1129] AD 2016 nr 21, Domskäl, Har ROL Retail en motfordran som ska kvittas?, del 2/3
  [K:639] AD 1994 nr 79, Domskäl, Tystnadsplikt, del 6/9
  [K:640] AD 1994 nr 79, Domskäl, Tystnadsplikt, del 7/9
  [K:1099] AD 2015 nr 39, Domskäl, Angrepp på företagshemligheter, del 1/3
  [K:880] AD 2010 nr 27, Domskäl, Allmänt skadestånd för brott mot lagen om skydd för företagshemligheter, del 2/2
  [K:1020] AD 2013 nr 24, Domskäl, K.K:s skadeståndsansvar enligt företagshemlighetslagen, del 1/3
  [K:145] SFS 2018:558 6 §
  [K:146] SFS 2018:558 7 §
  [K:800] AD 2003 nr 21, Domskäl, del 4/17
  [K:1520] AD 2020 nr 11, Bakgrund, del 2/3
Unused sources (2):
  [K:1537] AD 2020 nr 11, Domskäl, Allmänt om händelseförloppet, del 6/7
  [K:1586] AD 2020 nr 18, Domskäl, Tvisten
Source accuracy: 100 % (35 of 35 references)
Flagged references (0):

Context limit reached: 5 approved chunks were left out (--max-chunks 20).
To include every approved chunk, run again with a larger context:
  npm run query -- 'Sekretessavtal för en konsult som får tillgång till kunddata och affärsplaner.' --template nda --max-chunks 25 --max-context-chars 38639

Time (ms): translation 5735 · search 7 · judging 2 · generation 24428 · total 30173
Tokens: translation in 2 / out 667 · judging in 0 / out 0 · generation in 2 / out 2724
```
