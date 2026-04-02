#!/usr/bin/env python3
"""
Parse matrika PDF index (Hradec Králové archive) and export records to CSV.

Usage:
    python parse_pdf.py <pdf_path> [output_csv]

Each level-4 record in the PDF becomes one CSV row with fields:
    por_cislo, ukladaci_cislo, puvodni_signatura, signatura,
    neplatne_inventarni_cislo, nazev, datace, uredni_kniha,
    odkaz_prohlizet, odkaz_stahnout, jazyk, rozmery, pocet_folii,
    vazba, puvudce, matricni_misto, tematicky_popis, fyzicky_stav,
    cislo_mikrofilmu
"""

import sys
import csv
import re
import os


def ensure_pdfplumber():
    try:
        import pdfplumber
        return pdfplumber
    except ImportError:
        print("pdfplumber not found, installing...", flush=True)
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pdfplumber", "-q"])
        import pdfplumber
        return pdfplumber


def extract_text_pages(pdf_path):
    pdfplumber = ensure_pdfplumber()
    pages = []
    with pdfplumber.open(pdf_path) as pdf:
        total = len(pdf.pages)
        print(f"PDF has {total} pages, extracting text...", flush=True)
        for i, page in enumerate(pdf.pages, 1):
            text = page.extract_text(x_tolerance=3, y_tolerance=3) or ""
            pages.append(text)
            if i % 50 == 0:
                print(f"  {i}/{total} pages processed", flush=True)
    return pages


def split_into_records(pages):
    """Split full text into individual record blocks.

    Each level-4 record block starts with 'původní signatura:' and ends
    just before the next one (or EOF).
    """
    all_lines = []
    for page_text in pages:
        all_lines.extend(page_text.split("\n"))

    # Locate record start lines
    starts = [i for i, l in enumerate(all_lines) if l.strip().startswith("původní signatura:")]
    print(f"Found {len(starts)} records", flush=True)

    blocks = []
    for idx, start in enumerate(starts):
        end = starts[idx + 1] if idx + 1 < len(starts) else len(all_lines)
        # Also grab up to 3 lines BEFORE the start to capture por_cislo / ukladaci_cislo
        pre_start = max(0, start - 3)
        blocks.append(all_lines[pre_start:end])

    return blocks


def get_field(pattern, text, group=1, flags=re.IGNORECASE | re.MULTILINE):
    m = re.search(pattern, text, flags)
    return m.group(group).strip() if m else ""


def parse_record(lines):
    text = "\n".join(lines)

    record = {k: "" for k in [
        "por_cislo", "ukladaci_cislo",
        "puvodni_signatura", "signatura", "neplatne_inventarni_cislo",
        "nazev", "datace",
        "uredni_kniha",
        "odkaz_prohlizet", "odkaz_stahnout",
        "jazyk", "rozmery", "pocet_folii", "vazba",
        "puvudce", "matricni_misto",
        "tematicky_popis", "fyzicky_stav", "cislo_mikrofilmu",
    ]}

    # --- Sequential / storage number ---
    # Pattern from PDF: "4   <por_cislo>   <ukladaci_cislo>"  on one line
    # May appear as "4  10  6" or just the numbers without the "4" prefix
    for line in lines[:4]:
        m = re.match(r'^\s*4\s+(\d+)\s+(\d+)\s*$', line)
        if m:
            record["por_cislo"] = m.group(1)
            record["ukladaci_cislo"] = m.group(2)
            break
    if not record["por_cislo"]:
        # fallback: last number-only line before 'původní signatura:'
        sig_idx = next((i for i, l in enumerate(lines) if l.strip().startswith("původní signatura:")), None)
        if sig_idx:
            for line in reversed(lines[:sig_idx]):
                m = re.match(r'^\s*(\d+)\s+(\d+)\s*$', line.strip())
                if m:
                    record["por_cislo"] = m.group(1)
                    record["ukladaci_cislo"] = m.group(2)
                    break

    # --- Simple labeled fields ---
    record["puvodni_signatura"] = get_field(r'původní signatura:\s*(.+?)(?:\n|$)', text)
    record["signatura"] = get_field(r'(?:^|\n)signatura:\s*(.+?)(?:\n|$)', text)
    record["neplatne_inventarni_cislo"] = get_field(r'neplatné inventární číslo:\s*(.+?)(?:\n|$)', text)
    record["uredni_kniha"] = get_field(r'úřední kniha:\s*(.+?)(?:\n|$)', text)

    # --- Title and date range ---
    # Title block: lines between "neplatné inventární číslo:" and "úřední kniha:"
    title_m = re.search(
        r'neplatné inventární číslo:[^\n]*\n(.*?)(?=\núřední kniha:)',
        text, re.DOTALL | re.IGNORECASE
    )
    if title_m:
        title_raw = title_m.group(1).strip()
        # Date range is "YYYY–YYYY" or "měsíc YYYY – měsíc YYYY" at end of block
        date_patterns = [
            r'(\d{1,2}\.\s*\d{4}\s*[–-]\s*\d{1,2}\.\s*\d{4})\s*$',
            r'(\d{4}\s*[–-]\s*\d{4})\s*$',
            r'((?:leden|únor|březen|duben|květen|červen|červenec|srpen|září|říjen|listopad|prosinec)\s+\d{4}\s*[–-]\s*(?:leden|únor|březen|duben|květen|červen|červenec|srpen|září|říjen|listopad|prosinec)\s+\d{4})\s*$',
        ]
        for pat in date_patterns:
            dm = re.search(pat, title_raw, re.MULTILINE | re.IGNORECASE)
            if dm:
                record["datace"] = dm.group(1).strip()
                title_clean = title_raw[:dm.start()].strip()
                break
        else:
            title_clean = title_raw
        # Collapse whitespace in title
        record["nazev"] = re.sub(r'\s+', ' ', title_clean).strip()

    # --- Links ---
    # "Prohlížet v ARchivu ONline" and "Stáhnout všechny snímky" are clickable
    # pdfplumber may or may not capture URLs; capture the link text at minimum
    record["odkaz_prohlizet"] = get_field(r'(https?://[^\s]+(?:detail|view|record)[^\s]*)', text) or \
        ("Prohlížet v ARchivu ONline" if "ARchivu ONline" in text else "")
    record["odkaz_stahnout"] = get_field(r'(https?://[^\s]+(?:download|snimk)[^\s]*)', text) or \
        ("Stáhnout všechny snímky" if "Stáhnout všechny snímky" in text else "")

    # --- Physical description line ---
    # Format: "<jazyk(y)>; <dim> cm, <N> fol.; vazba: <vazba>"
    phys_m = re.search(
        r'((?:čeština|němčina|latina)(?:,\s*(?:čeština|němčina|latina))*)'
        r'\s*;\s*'
        r'([\d,\.x×\s]+cm)'
        r'\s*,\s*'
        r'(\d+\s*fol\.)'
        r'\s*;\s*vazba:\s*([^\n]+)',
        text, re.IGNORECASE
    )
    if phys_m:
        record["jazyk"] = phys_m.group(1).strip()
        record["rozmery"] = phys_m.group(2).strip()
        record["pocet_folii"] = phys_m.group(3).strip()
        record["vazba"] = phys_m.group(4).strip()

    # --- Původce (originator) ---
    # Runs until next labeled field
    puvudce_m = re.search(
        r'původce:\s*(.*?)(?=\n(?:matriční místo:|tematický|fyzický|existence))',
        text, re.DOTALL | re.IGNORECASE
    )
    if puvudce_m:
        record["puvudce"] = re.sub(r'\s+', ' ', puvudce_m.group(1)).strip()

    # --- Matriční místo ---
    mm_m = re.search(
        r'matriční místo:\s*(.*?)(?=\n(?:tematický|fyzický|existence|\Z))',
        text, re.DOTALL | re.IGNORECASE
    )
    if mm_m:
        record["matricni_misto"] = re.sub(r'\s+', ' ', mm_m.group(1)).strip()

    # --- Optional fields ---
    record["tematicky_popis"] = get_field(
        r'tematický popis jednotky popisu:\s*(.*?)(?=\n(?:fyzický|existence)|$)',
        text, flags=re.DOTALL | re.IGNORECASE
    )
    record["tematicky_popis"] = re.sub(r'\s+', ' ', record["tematicky_popis"]).strip()

    record["fyzicky_stav"] = get_field(
        r'fyzický stav[^:]*:\s*(.+?)(?:\n|$)', text
    )

    record["cislo_mikrofilmu"] = get_field(
        r'číslo mikrofilmu:\s*(.+?)(?:\n|$)', text
    )

    return record


FIELDNAMES = [
    "por_cislo", "ukladaci_cislo",
    "puvodni_signatura", "signatura", "neplatne_inventarni_cislo",
    "nazev", "datace",
    "uredni_kniha",
    "odkaz_prohlizet", "odkaz_stahnout",
    "jazyk", "rozmery", "pocet_folii", "vazba",
    "puvudce", "matricni_misto",
    "tematicky_popis", "fyzicky_stav", "cislo_mikrofilmu",
]


def parse_pdf(pdf_path, output_csv=None):
    if not os.path.exists(pdf_path):
        print(f"ERROR: File not found: {pdf_path}")
        sys.exit(1)

    if output_csv is None:
        base = os.path.splitext(pdf_path)[0]
        output_csv = base + ".csv"

    pages = extract_text_pages(pdf_path)
    blocks = split_into_records(pages)

    records = []
    for block in blocks:
        rec = parse_record(block)
        # Skip blocks that produced no meaningful data
        if rec["puvodni_signatura"] or rec["nazev"]:
            records.append(rec)

    print(f"Parsed {len(records)} records, writing to {output_csv}", flush=True)

    with open(output_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(records)

    print("Done.", flush=True)
    return output_csv, len(records)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <pdf_path> [output_csv]")
        sys.exit(1)
    pdf_path = sys.argv[1]
    output_csv = sys.argv[2] if len(sys.argv) > 2 else None
    parse_pdf(pdf_path, output_csv)
