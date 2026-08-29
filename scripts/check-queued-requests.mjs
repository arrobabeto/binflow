import { createDatabase } from '../packages/db/src/index.ts';
import { sql } from 'drizzle-orm';

const url =
  process.env.DATABASE_URL ??
  'postgresql://binflow:binflow_local@localhost:5432/binflow';
const { db, pool } = createDatabase(url);

const queued = await db.execute(sql`
  SELECT id, capability_id, state, topic, version, current_version, created_at
  FROM requests
  WHERE state = 'QUEUED'
  ORDER BY created_at DESC
  LIMIT 5
`);
const outbox = await db.execute(sql`
  SELECT id, event_type, status, job_key, attempts, payload
  FROM outbox_events
  WHERE event_type = 'workflow.resume_requested'
  ORDER BY created_at DESC
  LIMIT 10
`);
const versions = await db.execute(sql`
  SELECT rv.id, rv.request_id, rv.version, rv.confirmed_at, r.state
  FROM request_versions rv
  JOIN requests r ON r.id = rv.request_id
  WHERE r.state = 'QUEUED'
  ORDER BY rv.created_at DESC
  LIMIT 5
`);
const graphRuns = await db.execute(sql`
  SELECT gr.id, gr.request_id, gr.request_version_id, gr.status, gr.current_node
  FROM graph_runs gr
  JOIN requests r ON r.id = gr.request_id
  WHERE r.state = 'QUEUED'
  ORDER BY gr.started_at DESC NULLS LAST
  LIMIT 5
`);

console.log('QUEUED requests:', queued.rows);
console.log('Recent outbox:', outbox.rows);
console.log('Versions:', versions.rows);
console.log('Graph runs:', graphRuns.rows);

await pool.end();
