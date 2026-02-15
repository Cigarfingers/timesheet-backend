const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Railway injects DATABASE_URL automatically
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// PINs - change these if needed
const PINS = {
  '1311': 'daughter',  // Libby - can log and view
  '1987': 'parent'     // Parent - view only
};

// ── Setup DB on first run ──────────────────────────────────
async function setupDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shifts (
      id SERIAL PRIMARY KEY,
      shift_date DATE NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      hours_worked DECIMAL(4,2) NOT NULL,
      pay DECIMAL(8,2) NOT NULL,
      note TEXT,
      submitted BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('DB ready');
}
setupDB();

// ── Auth check ─────────────────────────────────────────────
app.post('/auth', (req, res) => {
  const { pin } = req.body;
  const role = PINS[pin];
  if (!role) return res.status(401).json({ error: 'Invalid PIN' });
  res.json({ role });
});

// ── Get all shifts ─────────────────────────────────────────
app.get('/shifts', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM shifts ORDER BY shift_date DESC, start_time DESC'
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Add a shift ────────────────────────────────────────────
app.post('/shifts', async (req, res) => {
  const { shift_date, start_time, end_time, note } = req.body;
  if (!shift_date || !start_time || !end_time) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Calculate hours
  const start = new Date(`2000-01-01T${start_time}`);
  const end = new Date(`2000-01-01T${end_time}`);
  if (end <= start) return res.status(400).json({ error: 'End time must be after start time' });

  const hours = (end - start) / 3600000;
  const pay = +(hours * 15).toFixed(2);

  try {
    const result = await pool.query(
      `INSERT INTO shifts (shift_date, start_time, end_time, hours_worked, pay, note)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [shift_date, start_time, end_time, hours, pay, note || null]
    );
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Delete a shift ─────────────────────────────────────────
app.delete('/shifts/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM shifts WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Get next 8 unsubmitted shifts ─────────────────────────
app.get('/shifts/next-block', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM shifts WHERE submitted = FALSE
       ORDER BY shift_date ASC, start_time ASC LIMIT 8`
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Mark shifts as submitted ───────────────────────────────
app.post('/shifts/mark-submitted', async (req, res) => {
  const { ids } = req.body;
  if (!ids || !ids.length) return res.status(400).json({ error: 'No IDs provided' });
  try {
    await pool.query(
      'UPDATE shifts SET submitted = TRUE WHERE id = ANY($1)',
      [ids]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
