# Example draft: `employment`

A real run of `npm run query` (E6-2) on 2026-10-11, kept to show what the `employment` prompt template produces. The instruction is eval query `anst-01` from `eval/queries.yaml`; the parties are the template's fictional defaults.

```bash
npm run query -- "Anställningsavtal för en säljare med provision och konkurrensklausul i tolv månader efter anställningens slut." --template employment
```

Settings: `LLM_PROVIDER=claude-code` (the Claude Code subscription, no API key), query translator and judge `claude-haiku-5-5`, generator `claude-sonnet-5-5`, `JUDGE_IMPL=llm` (no JEV key yet, so the LLM judged, as in E5-3; its scores came from the judge cache of the E5-3 evaluation where available), default context limits. The source accuracy and flagged references below were added afterwards by running the E6-3 post-check over this draft and its submitted chunks; the run itself printed E6-2's interim line "Citations outside the submitted chunks: 0".

## Query

```text
Tags: anstallningsavtal, tillsvidareanstallning, provanstallning, visstidsanstallning, skriftlig-information-villkor, arbetsskyldighet, kollektivavtal, lon, formaner, pension, overtidsersattning, arbetstid, overtid, semesterratt, semesterlon, uppsagningstid, uppsagning-arbetstagare, saklig-grund, avskedande, konkurrensklausul, tystnadsplikt, lojalitetsplikt, bisyssla, ratt-till-arbetsresultat, personuppgifter, bundenhetstid, ersattning-bundenhetstid, konkurrensklausul-skalighet, provision, kundklausul, overenskommelse-1969
Candidates: 30 · approved: 16 · unknown: 0 · judge calls: 2 · cache hits: 28
Submitted to the generator: 16
```

## Draft

# Anställningsavtal – säljare med provision

## Parter

**Arbetsgivare:** Exempelbolaget AB, org.nr 556000-0000, Storgatan 1, 111 22 Stockholm

**Arbetstagare:** Anna Andersson, personnummer 19900101-0000, Lillgatan 2, 111 33 Stockholm

Arbetsgivarens och arbetstagarens namn och adress, tillträdesdag och arbetsplats ska anges i anställningsavtalet.[K:18]

## Anställningsform

Anställningen gäller tills vidare.[K:9] Tillträdesdag är [tillträdesdag]. Arbetsplatsen är [arbetsort/arbetsplats]. Om arbetet ska utföras på olika platser, eller om arbetstagaren själv får bestämma sin arbetsplats, anges det här: [ange om det är aktuellt].[K:18]

## Provanställning

[Ange om provanställning ska gälla. Om den gäller, ange prövotidens längd och eventuella villkor.][K:18] Om ingen provanställning avtalas gäller anställningen från början utan prövotid.

## Arbetsuppgifter

Arbetstagaren anställs som säljare. Arbetstagaren ska sälja arbetsgivarens produkter och tjänster samt bearbeta och vårda kunder. Närmare arbetsuppgifter är [kort beskrivning av arbetsuppgifter och kundkrets]. Yrkesbenämning/tjänstetitel är [yrkesbenämning/tjänstetitel].[K:18] Arbetsgivaren leder och fördelar arbetet.

## Lön

Begynnelselön är [fast månadslön] kronor per månad. Provision utgår enligt [provisionsmodell: grund, procentsats, intjänande och utbetalning]. Lön och andra löneförmåner anges separat.[K:18] Lönen betalas ut [utbetalningsdag och sätt, till exempel månadsvis i efterskott till angivet bankkonto].[K:18]

## Arbetstid

Ordinarie arbetstid är [antal timmar] timmar per vecka, fördelade enligt [arbetstidens förläggning]. Arbetstiden regleras i övrigt av arbetstidslagen och tillämpligt kollektivavtal, om sådant finns: [kollektivavtal, om tillämpligt].

## Semester

Arbetstagaren har rätt till semester enligt semesterlagen. Semesterlön och eventuell semesterersättning på rörliga lönedelar, såsom provision, beräknas enligt semesterlagen [och, i förekommande fall, kollektivavtal].

## Uppsägning

Anställningen kan sägas upp av arbetsgivaren eller arbetstagaren och upphör då efter en uppsägningstid.[K:9] Uppsägningstiden är den som följer av lag [alternativt: ange avtalad längre uppsägningstid: uppsägningstid utöver lagens].[K:18] Uppsägning ska vara skriftlig. Reglerna om avskedande och om arbetstagarens rätt att frånträda anställningen med omedelbar verkan följer av lag.[K:9]

## Konkurrensklausul

1. Under anställningstiden får arbetstagaren inte bedriva eller ta anställning i verksamhet som konkurrerar med arbetsgivarens verksamhet.
2. Under tolv månader efter anställningens upphörande får arbetstagaren inte [alternativ A: bedriva eller ta anställning i verksamhet som konkurrerar med arbetsgivarens verksamhet inom [geografiskt område]] / [alternativ B, rekommenderad: aktivt bearbeta eller förmå sådana kunder att övergå till konkurrerande verksamhet, som arbetstagaren har haft kundansvar för eller bearbetat under de [antal] månader som föregick anställningens upphörande].[K:1016][K:788]
3. Klausulens syfte är att skydda arbetsgivarens bestående kundrelationer, företagsspecifika kunnande och företagshemligheter.[K:1043][K:872] Syftet är inte att hindra konkurrens i allmänhet eller att hålla kvar arbetstagaren i anställningen.[K:1043][K:1016]
4. Arbetstagaren ersätts under karenstiden med [kompensation under bindningstiden: belopp/procent av lönen och utbetalningssätt].[K:1043][K:865]
5. Vid överträdelse utgår [skadestånd/vite: belopp eller beräkningsgrund]. Beloppet ska stå i rimlig proportion till arbetsgivarens skada och till arbetstagarens lön.[K:1045][K:1043]
6. Klausulen är bindande endast i den utsträckning den är skälig enligt 38 § avtalslagen. Om den går längre än vad som är skäligt, ska den tillämpas i den omfattning som är skälig.[K:727][K:1016]

## Sekretess

Arbetstagaren får under anställningen och efter dess upphörande inte obehörigen röja eller utnyttja uppgifter om arbetsgivarens affärs- och driftsförhållanden, kunder, priser, metoder eller andra företagshemligheter.[K:1043] Skyldigheten gäller i den utsträckning som lag medger. Den påverkar inte arbetstagarens lagstadgade rättigheter. Vid anställningens upphörande ska arbetstagaren lämna tillbaka allt material som tillhör arbetsgivaren.

_Detta är ett utkast framtaget som underlag och utgör inte juridisk rådgivning._

## Sources, citations and timing

```text
Sources used (9):
  [K:18] SFS 1982:80 6 c § st. 2, del 1/2
  [K:9] SFS 1982:80 4 §
  [K:1016] AD 2013 nr 24, Domskäl, K.K:s skadeståndsansvar för brott mot konkurrensklausulen, del 1/4
  [K:788] AD 2002 nr 115, Domskäl, Vitesklausulen, del 1/3
  [K:1043] AD 2015 nr 8, Domskäl, Är konkurrensklausulen oskälig enligt 38 § avtalslagen?, del 2/5
  [K:872] AD 2010 nr 27, Domskäl, Konkurrensförbudet
  [K:865] AD 2009 nr 63, Domskäl, Frågan om brott mot anställningsavtalen efter anställningarnas upphörande, del 1/3
  [K:1045] AD 2015 nr 8, Domskäl, Är konkurrensklausulen oskälig enligt 38 § avtalslagen?, del 4/5
  [K:727] AD 2001 nr 91, Domskäl, del 1/5
Unused sources (7):
  [K:731] AD 2001 nr 91, Domskäl, del 5/5
  [K:730] AD 2001 nr 91, Domskäl, del 4/5
  [K:1039] AD 2015 nr 8, Domskäl, Bakgrund och tvisten, del 1/2
  [K:739] AD 2002 nr 15, Domskäl, Parternas ståndpunkter i fråga om avtalets giltighet
  [K:740] AD 2002 nr 15, Domskäl, Frågan om anställningsform, del 1/6
  [K:741] AD 2002 nr 15, Domskäl, Frågan om anställningsform, del 2/6
  [K:935] AD 2010 nr 90, Inledning, T.S. har nu anställning i konkurrerande verksamhet
Source accuracy: 85 % (23 of 27 references)
Flagged references (4):
  1651–1666 free-text "arbetstidslagen": no submitted chunk is from SFS 1982:673
  1808–1821 free-text "semesterlagen": no submitted chunk is from SFS 1977:480
  1923–1936 free-text "semesterlagen": no submitted chunk is from SFS 1977:480
  3668–3684 free-text "38 § avtalslagen": no submitted chunk is from SFS 1915:218 38 §

Time (ms): translation 8502 · search 8 · judging 4952 · generation 25091 · total 38553
Tokens: translation in 2 / out 932 · judging in 4 / out 500 · generation in 2 / out 2760
```
