'use strict';
// Tagged-template trick: sql(['raw string']) == sql`raw string`
const { neon } = require('@neondatabase/serverless');

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) { console.error('DATABASE_URL not set'); process.exit(1); }

const sql = neon(dbUrl);
const exec = (stmt) => sql([stmt]); // raw DDL: no interpolations

async function main() {
  const stmts = [
    `CREATE EXTENSION IF NOT EXISTS unaccent`,
    `CREATE EXTENSION IF NOT EXISTS pg_trgm`,
    `CREATE OR REPLACE FUNCTION immutable_unaccent(text)
       RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
     AS $$SELECT unaccent($1)$$`,
    `CREATE TABLE IF NOT EXISTS app_meta (
       key   TEXT PRIMARY KEY,
       value TEXT NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS records (
       id                        SERIAL PRIMARY KEY,
       por_cislo                 TEXT,
       ukladaci_cislo            TEXT,
       puvodni_signatura         TEXT,
       signatura                 TEXT,
       neplatne_inventarni_cislo TEXT,
       nazev                     TEXT,
       datace                    TEXT,
       nabozensky_puvod          TEXT,
       uredni_kniha              TEXT,
       odkaz_prohlizet           TEXT,
       odkaz_stahnout            TEXT,
       rozmery                   TEXT,
       pocet_folii               TEXT,
       vazba                     TEXT,
       tematicky_popis           TEXT,
       fyzicky_stav              TEXT,
       omezeni_pristupnosti      TEXT,
       rok_od                    INT,
       rok_do                    INT,
       jazyk                     TEXT[] NOT NULL DEFAULT '{}',
       puvodce                   TEXT[] NOT NULL DEFAULT '{}',
       matricni_misto            TEXT[] NOT NULL DEFAULT '{}',
       matricni_misto_zkracene   TEXT[] NOT NULL DEFAULT '{}',
       cislo_mikrofilmu          TEXT[] NOT NULL DEFAULT '{}',
       typ                       TEXT[] NOT NULL DEFAULT '{}',
       search_vector TEXT
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_records_por_cislo ON records (por_cislo)`,
    `CREATE INDEX IF NOT EXISTS idx_records_search_trgm ON records USING GIN (search_vector gin_trgm_ops)`,
    `CREATE INDEX IF NOT EXISTS idx_records_rok_od  ON records (rok_od)`,
    `CREATE INDEX IF NOT EXISTS idx_records_rok_do  ON records (rok_do)`,
    `CREATE INDEX IF NOT EXISTS idx_records_typ     ON records USING GIN (typ)`,
    `CREATE INDEX IF NOT EXISTS idx_records_jazyk   ON records USING GIN (jazyk)`,
    `CREATE INDEX IF NOT EXISTS idx_records_vyzani  ON records (nabozensky_puvod)`,
  ];

  for (const stmt of stmts) {
    const label = stmt.trim().slice(0, 70).replace(/\s+/g, ' ');
    try {
      await exec(stmt);
      console.log('OK :', label);
    } catch (e) {
      console.error('ERR:', label, '\n    ', e.message);
      process.exit(1);
    }
  }
  console.log('\nSchema applied successfully.');
}

main();
