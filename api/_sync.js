'use strict';
const fs = require('fs');
const path = require('path');
const { getDb } = require('./_db');

// Per-instance flag: skip all I/O on warm Function instances that already synced
let instanceSynced = false;

async function ensureSynced() {
  if (instanceSynced) return;

  const hashFile = path.join(__dirname, '..', 'data_hash.txt');
  const currentHash = fs.readFileSync(hashFile, 'utf8').trim();

  const sql = getDb();
  const rows = await sql`SELECT value FROM app_meta WHERE key = 'data_hash'`;
  const storedHash = rows[0]?.value ?? null;

  if (storedHash === currentHash) {
    instanceSynced = true;
    return;
  }

  console.log(`Sync needed: stored=${storedHash ?? 'none'} current=${currentHash}`);
  await syncData(sql, currentHash);
  instanceSynced = true;
}

async function syncData(sql, newHash) {
  const dataPath = path.join(__dirname, '..', 'data.json');
  const records = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  console.log(`Syncing ${records.length} records in batches...`);

  // Use sql.transaction() to send each batch as a single HTTP request to Neon.
  // 200 rows per batch → ~64 round-trips instead of 12,784.
  const BATCH = 200;
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    await sql.transaction(batch.map(r => {
      // Compute search_vector in JS: unaccented (NFD+strip) + lowercase of full place names
      const sv = (r.matricni_misto ?? [])
        .join(' ')
        .normalize('NFD').replace(/\p{Diacritic}/gu, '')
        .toLowerCase();
      return sql`
        INSERT INTO records (
          por_cislo, ukladaci_cislo, puvodni_signatura, signatura,
          neplatne_inventarni_cislo, nazev, datace, nabozensky_puvod,
          uredni_kniha, odkaz_prohlizet, odkaz_stahnout, rozmery,
          pocet_folii, vazba, tematicky_popis, fyzicky_stav,
          omezeni_pristupnosti, rok_od, rok_do,
          jazyk, puvodce, matricni_misto, matricni_misto_zkracene,
          cislo_mikrofilmu, typ, search_vector
        ) VALUES (
          ${r.por_cislo ?? null}, ${r.ukladaci_cislo ?? null},
          ${r.puvodni_signatura ?? null}, ${r.signatura ?? null},
          ${r.neplatne_inventarni_cislo ?? null}, ${r.nazev ?? null},
          ${r.datace ?? null}, ${r.nabozensky_puvod ?? null},
          ${r.uredni_kniha ?? null}, ${r.odkaz_prohlizet ?? null},
          ${r.odkaz_stahnout ?? null}, ${r.rozmery ?? null},
          ${r.pocet_folii ?? null}, ${r.vazba ?? null},
          ${r.tematicky_popis ?? null}, ${r.fyzicky_stav ?? null},
          ${r.omezeni_pristupnosti ?? null},
          ${r.rok_od ?? null}, ${r.rok_do ?? null},
          ${r.jazyk ?? []}, ${r.puvodce ?? []},
          ${r.matricni_misto ?? []}, ${r.matricni_misto_zkracene ?? []},
          ${r.cislo_mikrofilmu ?? []}, ${r.typ ?? []}, ${sv}
        )
        ON CONFLICT (por_cislo) DO UPDATE SET
          ukladaci_cislo            = EXCLUDED.ukladaci_cislo,
          puvodni_signatura         = EXCLUDED.puvodni_signatura,
          signatura                 = EXCLUDED.signatura,
          neplatne_inventarni_cislo = EXCLUDED.neplatne_inventarni_cislo,
          nazev                     = EXCLUDED.nazev,
          datace                    = EXCLUDED.datace,
          nabozensky_puvod          = EXCLUDED.nabozensky_puvod,
          uredni_kniha              = EXCLUDED.uredni_kniha,
          odkaz_prohlizet           = EXCLUDED.odkaz_prohlizet,
          odkaz_stahnout            = EXCLUDED.odkaz_stahnout,
          rozmery                   = EXCLUDED.rozmery,
          pocet_folii               = EXCLUDED.pocet_folii,
          vazba                     = EXCLUDED.vazba,
          tematicky_popis           = EXCLUDED.tematicky_popis,
          fyzicky_stav              = EXCLUDED.fyzicky_stav,
          omezeni_pristupnosti      = EXCLUDED.omezeni_pristupnosti,
          rok_od                    = EXCLUDED.rok_od,
          rok_do                    = EXCLUDED.rok_do,
          jazyk                     = EXCLUDED.jazyk,
          puvodce                   = EXCLUDED.puvodce,
          matricni_misto            = EXCLUDED.matricni_misto,
          matricni_misto_zkracene   = EXCLUDED.matricni_misto_zkracene,
          cislo_mikrofilmu          = EXCLUDED.cislo_mikrofilmu,
          typ                       = EXCLUDED.typ,
          search_vector             = EXCLUDED.search_vector
      `;
    }));
    console.log(`  Upserted ${Math.min(i + BATCH, records.length)} / ${records.length}`);
  }

  // Remove records no longer present in data.json
  const allPorCislo = records.map(r => r.por_cislo).filter(Boolean);
  await sql`DELETE FROM records WHERE por_cislo != ALL(${allPorCislo})`;

  // Store the new hash so subsequent instances skip the sync
  await sql`
    INSERT INTO app_meta (key, value) VALUES ('data_hash', ${newHash})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;

  console.log(`Sync complete: ${records.length} records`);
}

module.exports = { ensureSynced };
