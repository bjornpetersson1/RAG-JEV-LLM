// What each number in the UI measures, why, and how to read it (E7-11), for a lawyer or client:
// plain words, a technical term explained in the same sentence.

/** Every measure the UI shows with an (i) button. */
export type Measure =
  | 'translation'
  | 'search'
  | 'embedding'
  | 'rerank'
  | 'rerankDetail'
  | 'sources'
  | 'generation'
  | 'generationDetail'
  | 'total'
  | 'comparison'
  | 'configuration'
  | 'sourceAccuracy'
  | 'flagged'
  | 'score'
  | 'origin'
  | 'cited'
  | 'sent'
  | 'notSent'
  | 'tags'
  | 'candidates'
  | 'fallback'
  | 'approved'
  | 'sentCount';

export interface Explanation {
  /** What the measure is called in the button's name, "Vad betyder <name>?". */
  name: string;
  text: string;
}

export const EXPLANATIONS: Record<Measure, Explanation> = {
  translation: {
    name: 'Översättning',
    text:
      'Tiden för att låta en AI översätta din instruktion till juridiska ämnestaggar, t.ex. ' +
      '”konkurrensklausul”. Bara ett flöde som söker på taggar har steget, i standardinställningen ' +
      'huvudflödet. En lång tid här betyder att AI-anropet tog tid, inte att sökningen var långsam.',
  },
  search: {
    name: 'Sökning',
    text:
      'Tiden för att hitta kandidater, alltså de lagparagrafer och domskäl som kan vara relevanta, ' +
      'och läsa in dem. Med taggar slås de upp i ett register; med vektorsökning letar flödet efter ' +
      'texter som liknar instruktionen. Vilken sökning ett flöde använde står i dess konfiguration. ' +
      'Sökningen är oftast en liten del av den totala tiden.',
  },
  embedding: {
    name: 'inbäddning',
    text:
      'En del av sökningen: tiden för att räkna om instruktionen till en sifferrepresentation ' +
      '(inbäddning) som kan jämföras med texterna. Bara ett flöde som letar efter liknande texter har ' +
      'steget: referens-RAG:en, och huvudflödet om det är inställt på vektorsökning.',
  },
  rerank: {
    name: 'Rerank',
    text:
      'Tiden för att bedöma vilka kandidater som är relevanta för instruktionen. Med en AI-domare ' +
      '(standard) läses varje kandidat och får ett ja eller nej; med en lokal rankningsmodell får ' +
      'varje kandidat en poäng och de bästa går vidare. Vad flödet använde står i konfigurationen ' +
      '(reranker). Med en AI-domare tar steget oftast längst tid innan utkastet börjar skrivas.',
  },
  rerankDetail: {
    name: 'tid per bedömd kandidat och cacheträffar',
    text:
      'Tid per bedömd kandidat är domarens tid delad med antalet kandidater den faktiskt läste. ' +
      'Cacheträffar är kandidater som redan hade bedömts för samma instruktion, så svaret ' +
      'återanvändes utan ett nytt AI-anrop. Många cacheträffar gör steget snabbare än en ny körning.',
  },
  sources: {
    name: 'Tid till källor',
    text:
      'Sökningen plus domarens bedömning: hur lång tid det tar innan flödet vet vilka källor ' +
      'utkastet ska bygga på. Det är jämförelsens viktigaste mått, eftersom utkastets längd ' +
      'påverkar den totala tiden. Huvudflödets översättning ingår inte här men redovisas i ' +
      'jämförelsen under tabellen.',
  },
  generation: {
    name: 'Generering',
    text:
      'Tiden för AI:n att skriva utkastet utifrån de godkända källorna. Ett längre utkast tar ' +
      'längre tid, så tiden säger mer om utkastets längd än om flödet.',
  },
  generationDetail: {
    name: 'tokens och tid per token',
    text:
      'Tokens är de ord och orddelar AI:n skrev. Tid per token gör utkast av olika längd ' +
      'jämförbara: är den lika i båda flödena beror skillnaden i genereringstid bara på längden.',
  },
  total: {
    name: 'Totalt',
    text:
      'Hela körningens tid, från att frågan skickades tills utkastet var klart. Den påverkas av ' +
      'utkastets längd och säger därför mindre om källsökningen än Tid till källor.',
  },
  comparison: {
    name: 'jämförelsen',
    text:
      'Jämförelsen visar hur mycket tidigare eller senare huvudflödet hade sina källor än ' +
      'referens-RAG:en, först utan och sedan med huvudflödets översättning till taggar, och vilka ' +
      'steg skillnaden består av. Kortare tid till källor betyder att flödet snabbare vet vad ' +
      'utkastet ska bygga på. En enda körning säger lite; mätningen görs över alla testfrågor.',
  },
  configuration: {
    name: 'konfigurationen',
    text:
      'Vad flödet körde med: sökmetod (hämtning), taggindex (registret taggarna slås upp i), AI:n ' +
      'som översätter, domaren (reranker), hur många källor som högst skickas till utkastet och AI:n ' +
      'som skriver. Jämför bara körningar med samma konfiguration.',
  },
  sourceAccuracy: {
    name: 'Källträffsäkerhet',
    text:
      'Andelen av utkastets hänvisningar, t.ex. ”7 § LAS” eller en källmarkering, som pekar på en ' +
      'källa AI:n faktiskt fick. 100 % betyder att varje hänvisning har stöd i källorna; en lägre ' +
      'siffra betyder att AI:n hänvisat till något den inte fått, och de hänvisningarna måste ' +
      'kontrolleras.',
  },
  flagged: {
    name: 'flaggade',
    text:
      'Hänvisningar som inte matchar någon källa AI:n fick. De är markerade i utkastet; håll ' +
      'muspekaren över en för att se varför. En flaggad hänvisning kan vara fel eller bara sakna ' +
      'källa här, så kontrollera den.',
  },
  score: {
    name: 'poäng',
    text:
      'Domarens eller rankarens bedömning av hur relevant källan är, från 0 till 1, med modellens ' +
      'namn inom parentes. Högre är mer relevant. En AI-domare godkänner källor över sin tröskel; ' +
      'en rankningsmodell har ingen tröskel, utan de högst rankade går vidare.',
  },
  origin: {
    name: 'ursprung',
    text:
      'Vilken sökning som hittade källan: tagg (ämnestaggar), fritext (ordsökning när taggarna gav ' +
      'för få träffar), vektor (texter som liknar instruktionen), BM25 (ordsökning som väger ' +
      'ovanliga ord tyngre) eller namngiven paragraf (en paragraf som instruktionen nämner).',
  },
  cited: {
    name: 'Citerade källor',
    text: 'Källor som utkastet hänvisar till. Det är dem utkastet bygger på, så kontrollera dem först.',
  },
  sent: {
    name: 'Skickade men inte citerade',
    text:
      'Källor som AI:n fick men inte hänvisade till. De kan ha påverkat texten utan att nämnas, ' +
      'eller varit överflödiga.',
  },
  notSent: {
    name: 'Inte skickade till generatorn',
    text:
      'Kandidater som aldrig nådde AI:n som skriver: antingen bedömde domaren dem som inte ' +
      'relevanta, eller så fick de inte plats inom gränsen för hur mycket text AI:n får läsa.',
  },
  tags: {
    name: 'taggar',
    text: 'Antalet ämnestaggar som instruktionen översattes till, och mallens förvalda taggar.',
  },
  candidates: {
    name: 'kandidater',
    text: 'Antalet textavsnitt sökningen hittade och gav domaren att bedöma.',
  },
  fallback: {
    name: 'från fritextsökning',
    text:
      'Kandidater som ordsökningen lade till, eftersom taggarna gav för få träffar. Många sådana ' +
      'betyder att taggarna passade instruktionen dåligt.',
  },
  approved: {
    name: 'godkända',
    text:
      'Kandidater som domaren bedömde som relevanta och som gick vidare till utkastet, högst så ' +
      'många som konfigurationen tillåter.',
  },
  sentCount: {
    name: 'skickade',
    text:
      'Antalet godkända källor som AI:n fick för att skriva utkastet, citerade eller inte. Det kan ' +
      'vara färre än de godkända om alla inte fick plats.',
  },
};

/** What the comparison is about, above the results. */
export const INTRODUCTION =
  'Här jämförs två sätt att hitta källor till ett avtalsutkast. Huvudflödet översätter i ' +
  'standardinställningen din instruktion till juridiska ämnestaggar och söker på dem; ' +
  'referens-RAG:en letar i stället efter texter som liknar instruktionen. Båda låter sedan samma ' +
  'AI-domare välja de relevanta källorna, och samma AI skriver utkastet, så skillnaden ligger i ' +
  'hur källorna hittas. Under tabellen står vad varje flöde körde med.';

/** One sentence per section, always visible. */
export const SECTION_LEADS = {
  timing:
    'Tabellen visar hur lång tid varje steg tog. Det jämförelsen handlar om är Tid till källor: ' +
    'hur snabbt flödet vet vilka källor utkastet ska bygga på.',
  check:
    'Efterkontrollen jämför varje hänvisning i utkastet med de källor AI:n fick, så att du ser ' +
    'vilka som har stöd.',
  sources:
    'Alla kandidater och vad som hände med dem: vilka utkastet citerar, vilka som skickades men ' +
    'inte citerades, och vilka som aldrig nådde AI:n.',
  runs:
    'Tidigare körningar från körloggen, nyast först. Utkast och källor sparas inte, bara ' +
    'tiderna, antalen och konfigurationen.',
} as const;

/** Why the UI's comparison is a demo, under the comparison. */
export const DEMO_NOTICE =
  'Siffrorna här är en demonstration. Domarens svar sparas, och referens-RAG:en körs efter ' +
  'huvudflödet med samma instruktion, så den kan återanvända huvudflödets bedömningar och verka ' +
  'snabbare. Den egentliga mätningen görs med npm run bench:compare, som kör alla testfrågor ' +
  'utan sparade svar.';
