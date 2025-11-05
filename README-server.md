Local JSON persistence server
================================

This adds a tiny Node/Express server that writes all users and their logs to `data/users.json` next to the web app.

Install and run
---------------

1) Install Node.js (if not installed).
2) From the `HydrationCoachWeb` directory:

```bash
npm install
npm run start
```

The site and API will be available at `http://localhost:3000/`.

API
---

- `GET /api/ping` → `{ ok: true }`
- `GET /api/users` → object keyed by email, each with `{ email, name, passwordHash, profile, logs }`
- `PUT /api/users` → replaces all users (send full object)
- `POST /api/users` → upsert one user (send `{ email, name?, passwordHash?, profile? }`)
- `POST /api/logs` → append one log to a user (send `{ email, log }`)

Data shape
----------

```json
{
  "user@example.com": {
    "email": "user@example.com",
    "name": "User",
    "passwordHash": "<sha256>",
    "profile": { "massKg": 70, "sweatRateLph": 1.1 },
    "logs": [ { "ts": 0, "input": {}, "plan": {}, "actualIntakeL": 0 } ]
  }
}
```


