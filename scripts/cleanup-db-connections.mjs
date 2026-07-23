import pg from "pg";

const connStr = "postgresql://postgres:087ab54d29910d40b3069ec7a437460f@rz7b4fhh.ap-southeast.database.insforge.app:5432/insforge?sslmode=require";

const client = new pg.Client({ 
  connectionString: connStr, 
  connectionTimeoutMillis: 15000,
  query_timeout: 20000
});

try {
  console.log("Connecting to InsForge PostgreSQL...");
  await client.connect();
  console.log("✓ Connected\n");
  
  // Get max connections
  const maxRes = await client.query("SHOW max_connections");
  console.log(`Max connections: ${maxRes.rows[0].max_connections}`);
  
  // Check active connections
  const statsRes = await client.query(`
    SELECT count(*) as total, 
           count(*) FILTER (WHERE state = 'active') as active,
           count(*) FILTER (WHERE state = 'idle') as idle,
           count(*) FILTER (WHERE state = 'idle in transaction') as idle_in_txn
    FROM pg_stat_activity 
    WHERE datname = 'insforge'
  `);
  console.log("Before cleanup:", statsRes.rows[0]);
  
  // Terminate all idle connections EXCEPT our own
  const killRes = await client.query(`
    SELECT pg_terminate_backend(pid), pid, state, query_start, state_change
    FROM pg_stat_activity 
    WHERE datname = 'insforge' 
      AND state = 'idle'
      AND pid <> pg_backend_pid()
      AND state_change < NOW() - INTERVAL '30 seconds'
  `);
  console.log(`\n✓ Terminated ${killRes.rowCount} stale idle connections`);
  
  // Re-check
  const afterRes = await client.query(`
    SELECT count(*) as total, 
           count(*) FILTER (WHERE state = 'active') as active,
           count(*) FILTER (WHERE state = 'idle') as idle
    FROM pg_stat_activity 
    WHERE datname = 'insforge'
  `);
  console.log("After cleanup:", afterRes.rows[0]);
  
  await client.end();
  console.log("\n✓ Done. Pool cleaned up.");
} catch (err) {
  console.error("Error:", err.message);
  try { await client.end(); } catch {}
  process.exit(1);
}
