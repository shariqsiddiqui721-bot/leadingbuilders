# ConstructFlow

Project-wise construction ledger: Owner, Labor, Material (linked to Supplier), Supplier Payable, Expected Income/Expense, Day Book.

## Deploy (same steps as StockFlow — GitHub + Railway)

1. **GitHub**
   - Create a new repository (e.g. `constructflow`)
   - Upload all these files to it

2. **Railway**
   - Go to railway.app → New Project → Deploy from GitHub repo → select `constructflow`
   - Add a **PostgreSQL** database from Railway's "New" menu (in the same project)
   - Railway auto-sets `DATABASE_URL` — no manual config needed
   - Deploy will run `npm start`, which also creates all database tables automatically on first boot

3. **Open the app**
   - Railway gives you a public URL (Settings → Generate Domain)
   - Open it on your phone — works like a normal website, add to home screen for app-like access

## Local test (optional, before deploying)
```
npm install
export DATABASE_URL=postgres://user:pass@localhost:5432/constructflow
npm start
```

## What's included
- `server.js` — API (Express + PostgreSQL)
- `schema.sql` — database tables (auto-run on boot)
- `public/index.html` — the app (single file, no build step)
- Projects → each has Owner / Labor / Material / Supplier / Expected / Day Book
- Material purchased "On Supplier" automatically creates a matching bill in that supplier's ledger
