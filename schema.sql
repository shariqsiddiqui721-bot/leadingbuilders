-- ConstructFlow schema

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- generic "head" tables: owner, labor, material, supplier
-- each head belongs to a project, and has a name
CREATE TABLE IF NOT EXISTS heads (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  section TEXT NOT NULL CHECK (section IN ('owner','labor','material','supplier')),
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS entries (
  id SERIAL PRIMARY KEY,
  head_id INTEGER NOT NULL REFERENCES heads(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,          -- e.g. received/due, wage/paid, used/paid, bill/paid
  amount NUMERIC(14,2) NOT NULL,
  entry_date DATE NOT NULL,
  note TEXT,
  source TEXT,                 -- for material: 'cash' or 'supplier'
  linked_supplier_head_id INTEGER REFERENCES heads(id) ON DELETE SET NULL,
  linked_entry_id INTEGER REFERENCES entries(id) ON DELETE CASCADE, -- pairs a material purchase with its auto-created supplier bill
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expected (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('income','expense')),
  amount NUMERIC(14,2) NOT NULL,
  entry_date DATE NOT NULL,
  note TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_heads_project ON heads(project_id);
CREATE INDEX IF NOT EXISTS idx_entries_head ON entries(head_id);
CREATE INDEX IF NOT EXISTS idx_expected_project ON expected(project_id);
