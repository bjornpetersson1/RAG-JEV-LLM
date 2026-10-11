# Prompt templates

The generator (E6-2) drafts a contract from one of these templates, the lawyer's instruction and the chunks the judge approved. There is one template per template id in `TEMPLATES` (`backend/src/tagging/vocabulary.ts`), the same ids that select the tag presets in query translation:

| Id           | File                             | Contract             |
| ------------ | -------------------------------- | -------------------- |
| `employment` | [`employment.md`](employment.md) | Employment agreement |
| `nda`        | [`nda.md`](nda.md)               | Non-disclosure (NDA) |

The templates are written in Swedish, instructions to the model included, so the drafts come out in natural Swedish legal language. This README, the code and the comments stay in English.

## File structure

A template is a Markdown file split into four parts by `##` headings. Anything before the first `##` (the `#` title) is ignored.

| Heading             | Used as                                             | Slots                                          |
| ------------------- | --------------------------------------------------- | ---------------------------------------------- |
| `## System`         | The system prompt: role, required sections, rules   | `{{disclaimer}}`                               |
| `## Användare`      | The user prompt of the call                         | `{{instruction}}`, `{{parties}}`, `{{chunks}}` |
| `## Standardparter` | Fictional parties, used when the request names none | none                                           |
| `## Friskrivning`   | The disclaimer line every draft ends with           | none                                           |

Every part must be present once and not be empty, every slot listed must appear in its part, and no other `{{…}}` may appear; otherwise loading the template fails with an error naming the file. Any other `##` heading is an error too, since it would start a new part (the drafts' own `##` headings are only mentioned in backticks).

## Slots

- `{{instruction}}`: the lawyer's instruction, as given.
- `{{parties}}`: the parties of the contract, or the template's `## Standardparter` when the request names none. The defaults are fictional.
- `{{chunks}}`: the approved chunks (at least one) in the order given (E6-2 orders them by judge score), each as its citation, its source reference and its text:

  ```
  [K:12] SFS 1982:80 5 §
  Ett avtal om tidsbegränsad anställning ...
  ```

- `{{disclaimer}}`: the `## Friskrivning` line.

Slots are filled in one pass, so text such as `{{chunks}}` inside the instruction is left as written.

## Citation format

The model cites a source by writing `[K:<chunk-id>]` right after the sentence or clause that rests on it, for example `Provanställningen får vara högst sex månader [K:12].` Several sources are written in a row: `[K:12][K:40]`.

- `<chunk-id>` is the chunk's id in the database (`chunks.id`), exactly as it appears in `{{chunks}}`.
- The templates ask for one id per bracket, but the parser (`findCitations` in `backend/src/generation/templates.ts`) also reads groups such as `[K:12, K:40]`.
- Only ids from the supplied chunks may be cited. The generator (E6-2) maps citations to source references, and the post-check (E6-3) flags any citation that does not match a submitted chunk.

## Placeholders

Only the parties may be invented (fictional). Any other detail the instruction does not give is written as a bracketed placeholder with a short description, such as `[lön]` or `[tillträdesdag]`. Placeholders never start with `K:`, which is what tells them apart from citations.

## Adding a template

1. Add the id to `TEMPLATES` in `backend/src/tagging/vocabulary.ts` (with its tag presets).
2. Add `prompts/<id>.md` with the four parts above.
3. Add its required sections to the template test in `backend/src/generation/templates.test.ts`.
