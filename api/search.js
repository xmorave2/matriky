'use strict';
const { getDb } = require('./_db');
const { ensureSynced } = require('./_sync');

const PAGE_SIZE = 20;

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    await ensureSynced();
  } catch (err) {
    console.error('Sync error:', err);
    return res.status(500).json({ error: 'Database sync failed' });
  }

  const { q = '', typ, jazyk, vyzani, rok, page = '1' } = req.query;

  const typArr   = typ    ? typ.split(',').map(s => s.trim()).filter(Boolean)    : [];
  const jazykArr = jazyk  ? jazyk.split(',').map(s => s.trim()).filter(Boolean)  : [];
  const vyzaniArr= vyzani ? vyzani.split(',').map(s => s.trim()).filter(Boolean) : [];
  const rokInt   = rok && /^\d+$/.test(rok) ? parseInt(rok, 10) : null;
  const pageNum  = Math.max(1, parseInt(page, 10) || 1);
  const offset   = (pageNum - 1) * PAGE_SIZE;

  const sql = getDb();

  try {
    // Normalize query the same way search_vector was built during sync
    const qNorm = q.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

    const rows = await sql`
      SELECT
        por_cislo, ukladaci_cislo, puvodni_signatura, signatura,
        neplatne_inventarni_cislo, nazev, datace, nabozensky_puvod,
        uredni_kniha, odkaz_prohlizet, odkaz_stahnout, rozmery,
        pocet_folii, vazba, tematicky_popis, fyzicky_stav,
        omezeni_pristupnosti, rok_od, rok_do,
        jazyk, puvodce, matricni_misto, matricni_misto_zkracene,
        cislo_mikrofilmu, typ,
        COUNT(*) OVER() AS total_count
      FROM records
      WHERE
        (${qNorm} = '' OR search_vector LIKE ${'%' + qNorm + '%'} OR (${q} != '' AND ${q} = ANY(matricni_misto)))
        AND (${typArr.length === 0} OR typ && ${typArr}::text[])
        AND (${jazykArr.length === 0} OR jazyk && ${jazykArr}::text[])
        AND (${vyzaniArr.length === 0} OR nabozensky_puvod = ANY(${vyzaniArr}::text[]))
        AND (${rokInt}::int IS NULL OR (rok_od <= ${rokInt} AND rok_do >= ${rokInt}))
      ORDER BY
        CASE WHEN ${qNorm} != '' THEN
          similarity(search_vector, ${qNorm})
        END DESC NULLS LAST,
        rok_od ASC NULLS LAST
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `;

    const total = rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0;
    const results = rows.map(r => {
      const { total_count, ...record } = r;
      return record;
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ total, page: pageNum, pageSize: PAGE_SIZE, results });
  } catch (err) {
    console.error('Search error:', err);
    return res.status(500).json({ error: 'Search failed' });
  }
};
