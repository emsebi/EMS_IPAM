import { createPool, initialize } from "./db.mjs";
import { renderRadiusFiles } from "./render.mjs";
const pool = createPool();
await initialize(pool);
await renderRadiusFiles(pool);
await pool.end();
