'use strict';
const { getDb } = require('./_db');
const { ensureSynced } = require('./_sync');

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

  const sql = getDb();

  try {
    const rows = await sql`
      SELECT DISTINCT unnest(matricni_misto_zkracene) AS place
      FROM records
      ORDER BY place
    `;

    const places = rows.map(r => r.place).filter(Boolean);

    // Sort using Czech collation in JS (Neon may not have cs_CZ collation)
    places.sort((a, b) => a.localeCompare(b, 'cs', { sensitivity: 'base' }));

    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    return res.status(200).json({ places });
  } catch (err) {
    console.error('Places error:', err);
    return res.status(500).json({ error: 'Failed to fetch places' });
  }
};
