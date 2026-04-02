---
name: parse-pdf
description: Analyzes a matrika index PDF from the Hradec Králové archive and creates a structured CSV file for database import. Use whenever the user downloads a new archival finding aid (archivní pomůcka) PDF from the Hradec Králové archive, mentions parsing matrika records, or wants to convert the registry book index to a spreadsheet/database.
---

# Parse Matrika PDF → CSV

Converts an archival finding aid PDF (Archivní pomůcka: matriky, SOA Hradec Králové) into a
structured CSV table, one row per level-4 record (individual registry book).

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

## CSV columns produced

| Column | Source field |
|--------|-------------|
| `por_cislo` | Poř. č. (sequential number) |
| `ukladaci_cislo` | Ukládací číslo (storage number) |
| `puvodni_signatura` | původní signatura |
| `signatura` | signatura |
| `neplatne_inventarni_cislo` | neplatné inventární číslo |
| `nazev` | Bold title text (type + localities) |
| `datace` | Date range on the right of the title |
| `uredni_kniha` | úřední kniha |
| `odkaz_prohlizet` | "Prohlížet v ARchivu ONline" link |
| `odkaz_stahnout` | "Stáhnout všechny snímky" link |
| `jazyk` | Language(s) from physical description |
| `rozmery` | Dimensions (e.g. "24x37,5 cm") |
| `pocet_folii` | Folio count (e.g. "326 fol.") |
| `vazba` | Binding type |
| `puvudce` | původce |
| `matricni_misto` | matriční místo |
| `tematicky_popis` | tematický popis jednotky popisu (if present) |
| `fyzicky_stav` | fyzický stav dokumentu … (if present) |
| `cislo_mikrofilmu` | číslo mikrofilmu |

## How to run

### Step 1 — Run the bundled script

```bash
python3 .claude/skills/parse-pdf/scripts/parse_pdf.py "<pdf_path>" ["<output.csv>"]
```

- `pdf_path` — path to the PDF (passed as skill argument or taken from context)
- `output_csv` — optional; defaults to `<pdf_name>.csv` next to the PDF, use `data.csv` if not asked by user to use other filename
- Installs `pdfplumber` automatically if missing

### Step 2 — Verify output

After the script finishes, spot-check the CSV:

```bash
python3 -c "
import csv
with open('<output.csv>', encoding='utf-8') as f:
    rows = list(csv.DictReader(f))
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
- The output CSV path
- Any obvious issues found during spot-check (empty key fields, malformed dates)

## Skill argument

The PDF file path comes from the skill invocation argument. If not provided, look in the
current working directory for a `.pdf` file, or ask the user.

## Edge cases

- **Pages before records** (title page, table of contents): skipped automatically — the script
  only processes text blocks that start with `původní signatura:`.
- **Multi-line fields** (`matriční místo`, `původce`, title): regex spans newlines.
- **Optional fields** (`fyzický stav`, `tematický popis`): left empty in CSV when absent.
- **Multiple microfilm numbers** (e.g. "2377, 2378"): captured as-is in `cislo_mikrofilmu`.
- **Mixed languages** (e.g. "čeština, němčina"): captured as-is in `jazyk`.
