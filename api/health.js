'use strict';
const { getDb } = require('./_db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sql = getDb();

  try {
    const [countRow] = await sql`SELECT COUNT(*)::int AS count FROM records`;
    const [hashRow]  = await sql`SELECT value FROM app_meta WHERE key = 'data_hash'`;

    return res.status(200).json({
      ok: true,
      records: countRow.count,
      hash: hashRow?.value ?? null,
    });
  } catch (err) {
    console.error('Health error:', err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
};
