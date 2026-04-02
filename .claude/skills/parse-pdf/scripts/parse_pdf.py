#!/usr/bin/env python3
"""
Parse matrika PDF index (Hradec Králové archive) and export records to JSON.

Usage:
    python parse_pdf.py <pdf_path> [output_json]

Each level-4 record in the PDF becomes one JSON object with fields:
    por_cislo, ukladaci_cislo, puvodni_signatura, signatura,
    neplatne_inventarni_cislo, nazev, datace, uredni_kniha,
    odkaz_prohlizet, odkaz_stahnout, jazyk, rozmery, pocet_folii,
    vazba, puvudce, matricni_misto, tematicky_popis, fyzicky_stav,
    cislo_mikrofilmu
"""

import sys
import json
import re
import os


def _extract_page_links(pdfium_c, doc, page):
    """Return (view_urls, dl_urls) sorted top-to-bottom by annotation Y position."""
    import ctypes
    links = []
    n = pdfium_c.FPDFPage_GetAnnotCount(page)
    for j in range(n):
        annot = pdfium_c.FPDFPage_GetAnnot(page, j)
        link = pdfium_c.FPDFAnnot_GetLink(annot)
        if link:
            action = pdfium_c.FPDFLink_GetAction(link)
            if action:
                buf = (ctypes.c_char * 1024)()
                nbytes = pdfium_c.FPDFAction_GetURIPath(doc, action, buf, 1024)
                if nbytes > 0:
                    url = buf.value[:nbytes].decode("utf-8", errors="replace")
                    rect = pdfium_c.FS_RECTF()
                    pdfium_c.FPDFAnnot_GetRect(annot, rect)
                    links.append((rect.top, url))
        pdfium_c.FPDFPage_CloseAnnot(annot)
    links.sort(key=lambda x: -x[0])  # top-to-bottom = decreasing Y in PDF coords
    view_urls = [u for _, u in links if "aron." in u or "/apu/" in u]
    dl_urls   = [u for _, u in links if "aron." not in u and "/apu/" not in u]
    return view_urls, dl_urls


def iter_page_texts(pdf_path):
    """Yield (page_num, total, text) one page at a time, releasing each page from memory
    immediately (pypdfium2 explicit close).

    Link annotations are injected as __VIEW_URL__ / __DL_URL__ marker lines right after the
    "ARchivu ONline" / "Stáhnout" text they belong to, so they end up in the correct record
    block during streaming. Falls back to pdfplumber (no link extraction) if pypdfium2 is absent.
    """
    try:
        import pypdfium2 as pdfium
        import pypdfium2.raw as pdfium_c
        doc = pdfium.PdfDocument(pdf_path)
        total = len(doc)
        print(f"PDF has {total} pages, extracting text...", flush=True)
        for i in range(total):
            page = doc[i]
            textpage = page.get_textpage()
            raw_text = textpage.get_text_range()
            textpage.close()
            view_urls, dl_urls = _extract_page_links(pdfium_c, doc, page)
            page.close()

            # Inject URL markers after matching link-text lines
            view_idx = dl_idx = 0
            out_lines = []
            for line in raw_text.splitlines():
                out_lines.append(line)
                if "ARchivu ONline" in line and view_idx < len(view_urls):
                    out_lines.append(f"__VIEW_URL__: {view_urls[view_idx]}")
                    view_idx += 1
                elif "Stáhnout všechny snímky" in line and dl_idx < len(dl_urls):
                    out_lines.append(f"__DL_URL__: {dl_urls[dl_idx]}")
                    dl_idx += 1

            yield i + 1, total, "\n".join(out_lines)
        doc.close()
    except ImportError:
        try:
            import pdfplumber
        except ImportError:
            import subprocess
            subprocess.check_call([sys.executable, "-m", "pip", "install", "pdfplumber", "-q"])
            import pdfplumber
        with pdfplumber.open(pdf_path) as pdf:
            total = len(pdf.pages)
            print(f"PDF has {total} pages, extracting text...", flush=True)
            for i, page in enumerate(pdf.pages, 1):
                text = page.extract_text(x_tolerance=3, y_tolerance=3) or ""
                yield i, total, text


def iter_records(pdf_path):
    """Yield line-blocks for each record, one page at a time (low memory).

    Each block is a list of lines: up to 3 pre-lines (for por_cislo /
    ukladaci_cislo) followed by lines from 'původní signatura:' up to
    (but not including) the next record boundary.
    """
    current_block = None  # lines belonging to the record being built
    pre_lines = []        # rolling window of lines before a record starts
    record_count = 0

    for i, total, text in iter_page_texts(pdf_path):
        for line in text.splitlines():
            if line.strip().startswith("původní signatura:"):
                if current_block is not None:
                    # The "4 <por_cislo> <ukladaci_cislo>" level-row line for the
                    # *next* record appears at the end of the current block,
                    # sometimes followed by page-break column headers.
                    # Scan backward, skip page headers, extract the level row.
                    _PAGE_HDR = re.compile(
                        r'^\s*(?:\d+|Označení|Obsah\s+Datace'
                        r'|Úrov\.\s*Poř\.\s*č\.\s*Ukládací\s*číslo)\s*$',
                        re.IGNORECASE,
                    )
                    _LEVEL_ROW = re.compile(r'^\s*4\s+\d+\s+\d+\s*$')
                    trailing = []
                    for _k in range(1, min(8, len(current_block)) + 1):
                        _l = current_block[-_k].strip()
                        if _LEVEL_ROW.match(_l):
                            trailing = [current_block[-_k]]
                            current_block = current_block[:-_k]
                            break
                        elif _PAGE_HDR.match(_l):
                            continue  # skip page header, keep scanning
                        else:
                            break     # real record data — stop
                    record_count += 1
                    yield current_block
                    pre_lines = trailing
                # Start new block: include recent pre-lines for por_cislo
                current_block = pre_lines[-3:] + [line]
                pre_lines = []
            elif current_block is not None:
                current_block.append(line)
            else:
                pre_lines.append(line)
                if len(pre_lines) > 3:
                    pre_lines.pop(0)
        if i % 50 == 0:
            print(f"  {i}/{total} pages processed", flush=True)

    if current_block is not None:
        record_count += 1
        yield current_block

    print(f"Found {record_count} records", flush=True)


def get_field(pattern, text, group=1, flags=re.IGNORECASE | re.MULTILINE):
    m = re.search(pattern, text, flags)
    return m.group(group).strip() if m else ""


def parse_record(lines):
    text = "\n".join(lines)

    record: dict = {k: "" for k in [
        "por_cislo", "ukladaci_cislo",
        "puvodni_signatura", "signatura", "neplatne_inventarni_cislo",
        "nazev", "datace",
        "uredni_kniha",
        "odkaz_prohlizet", "odkaz_stahnout",
        "rozmery", "pocet_folii", "vazba",
        "tematicky_popis", "fyzicky_stav",
    ]}
    # Array fields default to empty list
    record["jazyk"] = []
    record["puvudce"] = []
    record["matricni_misto"] = []
    record["cislo_mikrofilmu"] = []
    record["typ"] = []

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
    # Title block: lines between "neplatné inventární číslo:" and "úřední kniha:".
    # Fallback: some records lack "neplatné inventární číslo:" — use "signatura:" instead.
    title_m = re.search(
        r'neplatné inventární číslo:[^\n]*\n(.*?)(?=\núřední kniha:)',
        text, re.DOTALL | re.IGNORECASE
    )
    if not title_m:
        title_m = re.search(
            r'^signatura:[^\n]*\n(.*?)(?=\núřední kniha:)',
            text, re.DOTALL | re.IGNORECASE | re.MULTILINE
        )
    if title_m:
        title_raw = title_m.group(1).strip()
        # Date range is "YYYY–YYYY" or "měsíc YYYY – měsíc YYYY" at end of block
        _M = r'(?:leden|únor|březen|duben|květen|červen|červenec|srpen|září|říjen|listopad|prosinec)'
        date_patterns = [
            r'(\d{1,2}\.\s*\d{4}\s*[–-]\s*\d{1,2}\.\s*\d{4})\s*$',          # 5.1943 – 12.1949
            rf'({_M}\s+\d{{4}}\s*[–-]\s*{_M}\s+\d{{4}})\s*$',                # květen 1943 – prosinec 1949
            rf'({_M}\s+\d{{4}}\s*[–-]\s*\d{{4}})\s*$',                        # květen 1943 – 1949
            rf'(\d{{4}}\s*[–-]\s*{_M}\s+\d{{4}})\s*$',                        # 1943 – prosinec 1949
            r'(\d{4}\s*[–-]\s*\d{4})\s*$',                                    # 1943 – 1949
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

    # --- Record type(s) derived from nazev ---
    # Matches blocks like "matrika NAROZENÝCH, ZEMŘELÝCH" or "index ODDANÝCH"
    # and expands each into individual "matrika X" / "index X" entries.
    _TYPE_BLOCK_RE = re.compile(
        r'\b(matrika|index)\s+'
        r'((?:(?:NAROZENÝCH|ZEMŘELÝCH|ODDANÝCH)(?:,\s*)?)+)',
        re.IGNORECASE,
    )
    _TYPE_WORD_RE = re.compile(r'NAROZENÝCH|ZEMŘELÝCH|ODDANÝCH', re.IGNORECASE)
    typ = []
    for blk in _TYPE_BLOCK_RE.finditer(record["nazev"]):
        prefix = blk.group(1).lower()
        for tw in _TYPE_WORD_RE.findall(blk.group(2)):
            entry = f"{prefix} {tw.upper()}"
            if entry not in typ:
                typ.append(entry)
    record["typ"] = typ

    # --- Links (URLs injected as markers by iter_page_texts) ---
    record["odkaz_prohlizet"] = get_field(r'__VIEW_URL__:\s*(.+?)(?:\n|$)', text)
    record["odkaz_stahnout"]  = get_field(r'__DL_URL__:\s*(.+?)(?:\n|$)', text)

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
        # jazyk: comma-separated languages → array
        record["jazyk"] = [l.strip() for l in phys_m.group(1).split(',') if l.strip()]
        record["rozmery"] = phys_m.group(2).strip()
        record["pocet_folii"] = phys_m.group(3).strip()
        record["vazba"] = phys_m.group(4).strip()

    # --- Původce (originator) ---
    # Runs until next labeled field.
    # Multiple entries are separated by "), " before an uppercase letter.
    puvudce_m = re.search(
        r'původce:\s*(.*?)(?=\n(?:matriční místo:|tematický|fyzický|existence))',
        text, re.DOTALL | re.IGNORECASE
    )
    if puvudce_m:
        raw = re.sub(r'\s+', ' ', puvudce_m.group(1)).strip()
        # Split on "), " followed by an uppercase letter (next entry start)
        parts = re.split(r'\),\s+(?=[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ])', raw)
        record["puvudce"] = [p.strip().rstrip(',') + (')' if not p.strip().endswith(')') and i < len(parts)-1 else '') for i, p in enumerate(parts) if p.strip()]

    # --- Matriční místo ---
    # Semicolon-separated list of places → array
    mm_m = re.search(
        r'matriční místo:\s*(.*?)(?=\n(?:tematický|fyzický|existence|\Z))',
        text, re.DOTALL | re.IGNORECASE
    )
    if mm_m:
        raw = re.sub(r'\s+', ' ', mm_m.group(1)).strip()
        record["matricni_misto"] = [p.strip() for p in raw.split(';') if p.strip()]

    # --- Optional fields ---
    record["tematicky_popis"] = get_field(
        r'tematický popis jednotky popisu:\s*(.*?)(?=\n(?:fyzický|existence)|$)',
        text, flags=re.DOTALL | re.IGNORECASE
    )
    record["tematicky_popis"] = re.sub(r'\s+', ' ', record["tematicky_popis"]).strip()

    record["fyzicky_stav"] = get_field(
        r'fyzický stav[^:]*:\s*(.+?)(?:\n|$)', text
    )

    # cislo_mikrofilmu: comma-separated numbers → array
    cislo_raw = get_field(r'číslo mikrofilmu:\s*(.+?)(?:\n|$)', text)
    record["cislo_mikrofilmu"] = [n.strip() for n in re.split(r',\s*', cislo_raw) if n.strip()] if cislo_raw else []

    return record


def parse_pdf(pdf_path, output_json=None):
    if not os.path.exists(pdf_path):
        print(f"ERROR: File not found: {pdf_path}")
        sys.exit(1)

    if output_json is None:
        base = os.path.splitext(pdf_path)[0]
        output_json = base + ".json"

    records = []
    for block in iter_records(pdf_path):
        rec = parse_record(block)
        if rec["puvodni_signatura"] or rec["nazev"]:
            records.append(rec)

    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)

    print(f"Parsed {len(records)} records, written to {output_json}", flush=True)
    print("Done.", flush=True)
    return output_json, len(records)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <pdf_path> [output_csv]")
        sys.exit(1)
    pdf_path = sys.argv[1]
    output_json = sys.argv[2] if len(sys.argv) > 2 else None
    parse_pdf(pdf_path, output_json)
