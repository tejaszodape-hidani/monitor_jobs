# Job Monitor

## Deploy on Vercel (TypeScript)

The Vercel version is a static dashboard in `public/index.html` and a TypeScript API at `api/jobs.ts`. The browser fetches `/api/jobs`; the database password stays server-side and is never sent to visitors.

1. Import this folder into Vercel (or run `npx vercel`).
2. In **Project Settings → Environment Variables**, add `DATABASE_URL` from your local `.env`. Optionally add `APP_TIMEZONE` (defaults to `Asia/Kolkata`).
3. Deploy. Vercel serves the dashboard at `/`.

Do not deploy or share `.env`. A standalone HTML file cannot securely fetch your private MySQL database without a server-side API.

## Database migrations

To add a `country` column and backfill existing jobs with `US`, run the SQL in `migrations/001_add_country_to_jobs.sql` once with a MySQL client connected to your database. The column is `VARCHAR(100) NOT NULL DEFAULT 'US'`, so newly inserted jobs receive `US` unless the scraper supplies another value.

A read-only local dashboard for jobs added to the existing `Job` table. It shows counts for today and yesterday, lets you select any date, and lists matching jobs with search and pagination.

## Run

Your `.env` already needs `DATABASE_URL`. For MySQL, use a SQLAlchemy URL such as `mysql+pymysql://USER:PASSWORD@HOST:3306/DATABASE`.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5001.

The dashboard reads the date from `createdAt`; set `APP_TIMEZONE` in `.env` if the database timestamps use a timezone other than `Asia/Kolkata`. No migrations or writes are performed.
