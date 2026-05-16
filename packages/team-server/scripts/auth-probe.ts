import { getPool } from "../src/db/pool.js";
import { authenticate, findUserByEmail } from "../src/lib/auth.js";
const pool = getPool();
const found = await findUserByEmail("admin@qa.local", pool);
console.log("found:", found ? `${found.email}` : "null");
const auth = await authenticate("admin@qa.local", "password1234", pool);
console.log("auth:", auth ? "OK" : "null");
await pool.end();
