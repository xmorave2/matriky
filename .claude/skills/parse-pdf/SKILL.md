---
name: parse-pdf
description: Analyzes a matrika index PDF from the Hradec Králové archive and creates a structured JSON file for database import. Use whenever the user downloads a new archival finding aid (archivní pomůcka) PDF from the Hradec Králové archive, mentions parsing matrika records, or wants to convert the registry book index to a structured format.
---

# Parse Matrika PDF → JSON

Converts an archival finding aid PDF (Archivní pomůcka: matriky, SOA Hradec Králové) into a
JSON array, one object per level-4 record (individual registry book).

## Record structure in the PDF

Each record looks like this:

```
[level row]  <Poř. č.>        <Ukládací číslo>
původní signatura: VIII.
signatura: 1-3
neplatné inventární číslo: 6
římskokatolická matrika NAROZENÝCH, Babice, Barchov,          1837–1853
Kosičky (od 2.1837), Trnava (2.1837-11.1853)
úřední kniha: 1; EJ
odkazy:  Prohlížet v ARchivu ONline
         Stáhnout všechny snímky
čeština; 24x37,5 cm, 326 fol.; vazba: polokožená
původce: Farní úřad Babice (římskokatolický : Babice, Hradec Králové, Česko : 1855-2010)
matriční místo: Babice (Hradec Králové, Česko); Barchov ...
fyzický stav dokumentu a technické požadavky: poškozená vazba   ← optional
tematický popis jednotky popisu: fol. 116 ...                   ← optional
existence kopií jednotky popisu: číslo mikrofilmu: 2377
```

## JSON fields produced

| Field | Type | Source field |
|-------|------|-------------|
| `por_cislo` | string | Poř. č. (sequential number) |
| `ukladaci_cislo` | string | Ukládací číslo (storage number) |
| `puvodni_signatura` | string | původní signatura |
| `signatura` | string | signatura |
| `neplatne_inventarni_cislo` | string | neplatné inventární číslo |
| `nazev` | string | Title text (type + localities) |
| `datace` | string | Date range on the right of the title |
| `rok_od` | int\|null | Start year extracted from `datace` |
| `rok_do` | int\|null | End year extracted from `datace` |
| `uredni_kniha` | string | úřední kniha |
| `odkaz_prohlizet` | string | "Prohlížet v ARchivu ONline" link |
| `odkaz_stahnout` | string | "Stáhnout všechny snímky" link |
| `jazyk` | **array** | Language(s) — split on `", "` |
| `rozmery` | string | Dimensions (e.g. "24x37,5 cm") |
| `pocet_folii` | string | Folio count (e.g. "326 fol.") |
| `vazba` | string | Binding type |
| `puvodce` | **array** | původce — split on `"), "` before uppercase |
| `matricni_misto` | **array** | matriční místo — split on `"; "` |
| `tematicky_popis` | string | tematický popis jednotky popisu (if present) |
| `fyzicky_stav` | string | fyzický stav dokumentu … (if present) |
| `cislo_mikrofilmu` | **array** | číslo mikrofilmu — split on `", "` |
| `typ` | **array** | Record type(s) derived from `nazev` — each entry is one of: `"matrika NAROZENÝCH"`, `"matrika ZEMŘELÝCH"`, `"matrika ODDANÝCH"`, `"index NAROZENÝCH"`, `"index ZEMŘELÝCH"`, `"index ODDANÝCH"`. A combined title like `"matrika NAROZENÝCH, ZEMŘELÝCH"` expands to two entries. |

## How to run

### Step 1 — Run the bundled script

```bash
python3 .claude/skills/parse-pdf/scripts/parse_pdf.py "<pdf_path>" ["<output.json>"]
```

- `pdf_path` — path to the PDF (passed as skill argument or taken from context)
- `output_json` — optional; defaults to `<pdf_name>.json` next to the PDF, use `data.json` if not asked by user to use other filename
- Installs `pdfplumber` automatically if missing

### Step 2 — Verify output

After the script finishes, spot-check the JSON:

```bash
python3 -c "
import json
with open('<output.json>', encoding='utf-8') as f:
    rows = json.load(f)
print(f'{len(rows)} records')
print('Sample:', rows[0])
print('Sample:', rows[5])
"
```

Check that:
- Record count is plausible (hundreds to thousands)
- `nazev` looks like a proper matrika title
- `datace` contains a year range
- `signatura` is populated

### Step 3 — Report to user

Tell the user:
- How many records were extracted
- The output JSON path
- Any obvious issues found during spot-check (empty key fields, malformed dates)

## Skill argument

The PDF file path comes from the skill invocation argument. If not provided, look in the
current working directory for a `.pdf` file, or ask the user.

## Edge cases

- **Pages before records** (title page, table of contents): skipped automatically — the script
  only processes text blocks that start with `původní signatura:`.
- **Multi-line fields** (`matriční místo`, `původce`, title): regex spans newlines.
- **Optional fields** (`fyzický stav`, `tematický popis`): empty string `""` when absent; array fields (`jazyk`, `puvodce`, `matricni_misto`, `cislo_mikrofilmu`) are `[]` when absent.
- **Multiple microfilm numbers** (e.g. "2377, 2378"): captured as-is in `cislo_mikrofilmu`.
- **Mixed languages** (e.g. "čeština, němčina"): captured as-is in `jazyk`.
