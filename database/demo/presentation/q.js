// Reads SQL from stdin, runs it, prints the last result's rows as TSV.
const { connectWithRetry } = require('/app/database/scripts/lib');
let sql = ''; process.stdin.on('data', d => sql += d).on('end', async () => {
  const c = await connectWithRetry();
  try {
    let r = await c.query(sql); if (Array.isArray(r)) r = r[r.length - 1];
    if (r.rows && r.rows.length) { console.log(Object.keys(r.rows[0]).join('\t')); for (const row of r.rows) console.log(Object.values(row).map(v => v && typeof v === 'object' ? JSON.stringify(v) : v).join('\t')); }
    else console.log(`${r.command} ${r.rowCount ?? ''}`);
  } catch (e) { console.error('ERR', e.message); process.exitCode = 1; } finally { await c.end(); }
});
