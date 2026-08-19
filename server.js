const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

// sign of each mode per section: +1 increases the balance owed/due, -1 reduces it
const MODES = {
  owner: { received: -1, due: 1 },
  labor: { wage: 1, paid: -1 },
  material: { used: 1, paid: -1 },
  supplier: { bill: 1, paid: -1 },
};

async function initDb() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);
  console.log("DB ready");
}

// ---------- Projects ----------
app.get("/api/projects", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM projects ORDER BY created_at DESC");
  res.json(rows);
});

app.post("/api/projects", async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "name required" });
  const { rows } = await pool.query("INSERT INTO projects (name) VALUES ($1) RETURNING *", [name.trim()]);
  res.json(rows[0]);
});

app.delete("/api/projects/:id", async (req, res) => {
  await pool.query("DELETE FROM projects WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

// project summary: totals per section for one project
app.get("/api/projects/:id/summary", async (req, res) => {
  const projectId = req.params.id;
  const { rows: heads } = await pool.query(
    `SELECT h.*, COALESCE(json_agg(e.* ORDER BY e.entry_date DESC) FILTER (WHERE e.id IS NOT NULL), '[]') AS entries
     FROM heads h LEFT JOIN entries e ON e.head_id = h.id
     WHERE h.project_id = $1 GROUP BY h.id ORDER BY h.name`,
    [projectId]
  );

  const sectionTotals = { owner: 0, labor: 0, material: 0, supplier: 0 };
  for (const h of heads) {
    const modeMap = MODES[h.section];
    const bal = h.entries.reduce((sum, e) => sum + (modeMap[e.mode] || 0) * Number(e.amount), 0);
    h.balance = bal;
    sectionTotals[h.section] += bal;
  }

  const { rows: expected } = await pool.query("SELECT * FROM expected WHERE project_id=$1 ORDER BY entry_date DESC", [projectId]);
  const expectedIncome = expected.filter((e) => e.type === "income").reduce((s, e) => s + Number(e.amount), 0);
  const expectedExpense = expected.filter((e) => e.type === "expense").reduce((s, e) => s + Number(e.amount), 0);

  res.json({ heads, sectionTotals, expected, expectedIncome, expectedExpense });
});

// ---------- Heads (Owner/Labor/Material/Supplier entities) ----------
app.get("/api/projects/:projectId/heads/:section", async (req, res) => {
  const { projectId, section } = req.params;
  const { rows: heads } = await pool.query(
    "SELECT * FROM heads WHERE project_id=$1 AND section=$2 ORDER BY name",
    [projectId, section]
  );
  for (const h of heads) {
    const { rows: entries } = await pool.query("SELECT * FROM entries WHERE head_id=$1 ORDER BY entry_date DESC, id DESC", [h.id]);
    h.entries = entries;
    const modeMap = MODES[section];
    h.balance = entries.reduce((sum, e) => sum + (modeMap[e.mode] || 0) * Number(e.amount), 0);
  }
  res.json(heads);
});

app.post("/api/projects/:projectId/heads/:section", async (req, res) => {
  const { projectId, section } = req.params;
  const { name } = req.body;
  if (!MODES[section]) return res.status(400).json({ error: "invalid section" });
  if (!name || !name.trim()) return res.status(400).json({ error: "name required" });
  const { rows } = await pool.query(
    "INSERT INTO heads (project_id, section, name) VALUES ($1,$2,$3) RETURNING *",
    [projectId, section, name.trim()]
  );
  res.json(rows[0]);
});

app.delete("/api/heads/:id", async (req, res) => {
  await pool.query("DELETE FROM heads WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

// ---------- Entries ----------
app.post("/api/heads/:headId/entries", async (req, res) => {
  const { headId } = req.params;
  const { mode, amount, entry_date, note, source, supplier_head_id } = req.body;
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "amount required" });

  const { rows: headRows } = await pool.query("SELECT * FROM heads WHERE id=$1", [headId]);
  const head = headRows[0];
  if (!head) return res.status(404).json({ error: "head not found" });
  if (!MODES[head.section][mode]) return res.status(400).json({ error: "invalid mode" });

  const { rows } = await pool.query(
    `INSERT INTO entries (head_id, mode, amount, entry_date, note, source, linked_supplier_head_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [headId, mode, amount, entry_date, note || null, source || null, supplier_head_id || null]
  );
  const entry = rows[0];

  // material purchased on supplier credit -> mirror as a bill in supplier's ledger
  if (head.section === "material" && mode === "used" && source === "supplier" && supplier_head_id) {
    const { rows: supRows } = await pool.query("SELECT name FROM heads WHERE id=$1", [supplier_head_id]);
    const supplierName = supRows[0]?.name || "Supplier";
    const { rows: billRows } = await pool.query(
      `INSERT INTO entries (head_id, mode, amount, entry_date, note, linked_entry_id)
       VALUES ($1,'bill',$2,$3,$4,$5) RETURNING *`,
      [supplier_head_id, amount, entry_date, `${head.name}${note ? " · " + note : ""}`, entry.id]
    );
    await pool.query("UPDATE entries SET linked_entry_id=$1 WHERE id=$2", [billRows[0].id, entry.id]);
  }

  res.json(entry);
});

app.delete("/api/entries/:id", async (req, res) => {
  // also delete the mirrored supplier bill if this was a material purchase, or vice versa
  const { rows } = await pool.query("SELECT * FROM entries WHERE id=$1", [req.params.id]);
  const entry = rows[0];
  if (entry && entry.linked_entry_id) {
    await pool.query("DELETE FROM entries WHERE id=$1", [entry.linked_entry_id]);
  }
  await pool.query("DELETE FROM entries WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

// ---------- Expected income/expense ----------
app.post("/api/projects/:projectId/expected", async (req, res) => {
  const { projectId } = req.params;
  const { type, amount, entry_date, note } = req.body;
  if (!["income", "expense"].includes(type)) return res.status(400).json({ error: "invalid type" });
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "amount required" });
  const { rows } = await pool.query(
    "INSERT INTO expected (project_id, type, amount, entry_date, note) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [projectId, type, amount, entry_date, note || null]
  );
  res.json(rows[0]);
});

app.delete("/api/expected/:id", async (req, res) => {
  await pool.query("DELETE FROM expected WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

// ---------- Day book: all entries across all heads for a project ----------
app.get("/api/projects/:projectId/daybook", async (req, res) => {
  const { projectId } = req.params;
  const { rows } = await pool.query(
    `SELECT e.*, h.name AS head_name, h.section
     FROM entries e JOIN heads h ON h.id = e.head_id
     WHERE h.project_id = $1
     ORDER BY e.entry_date DESC, e.id DESC`,
    [projectId]
  );
  res.json(rows);
});

const PORT = process.env.PORT || 3000;
initDb().then(() => {
  app.listen(PORT, () => console.log(`ConstructFlow running on port ${PORT}`));
}).catch((err) => {
  console.error("Failed to init DB", err);
  process.exit(1);
});
