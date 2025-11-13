# Heat Coach

This is a project created for BMED 563 - Biomedical Engineering Graduate Seminar.

The goal of this project was to see how AI agents could be used quickly implament a prototype of an webapp to quickly begin testing with it. While I did provide direction and the ideas for the I want to be clear **I did not code any of this** or at least the vast majority of it. While I might have tweaked aspects of it, it was to get something to work that the AI could not do, like adding the weather API key and connecting it to a database to store user data.


Data storage layout
-------------------

All persisted data now lives in three domain-specific JSON files under `data/` and every record references a per-user private key. This keeps profile information isolated from activity plans and daily tracking data while still allowing them to relate to the same person.

- `data/profiles.json` (keyed by email)  
  ```json
  {
    "user@example.com": {
      "privateKey": "5a1ef0de-0a66-47d6-a9fa-6e6f7b3c64b5",
      "email": "user@example.com",
      "name": "User",
      "passwordHash": "<sha256>",
      "profile": { "massKg": 70, "sweatRateLph": 1.1 }
    }
  }
  ```
- `data/activity-plans.json` (keyed by private key)  
  ```json
  {
    "5a1ef0de-0a66-47d6-a9fa-6e6f7b3c64b5": [
      { "ts": 0, "input": {}, "plan": {}, "actualIntakeL": 0 }
    ]
  }
  ```
- `data/daily-tracking.json` (keyed by private key)  
  ```json
  {
    "5a1ef0de-0a66-47d6-a9fa-6e6f7b3c64b5": [
      {
        "date": "2025-11-11",
        "metrics": { "fluidL": 1.5, "caffeine": { "value": 200, "unit": "mg" } },
        "note": "Felt great",
        "urine": {
          "entries": [
            {
              "level": 3,
              "recordedAt": "2025-11-11T07:45:00.000Z"
            }
          ]
        }
      }
    ]
  }
  ```

Legacy single-file data automatically migrates to the new layout on server start (the original snapshot is archived as `users.legacy.json`).

## Production Deployment

### Environment Variables

For production deployment, set the following environment variables:

- **MONGO_URI** (required): Your MongoDB connection string
  - Format: `mongodb+srv://username:password@cluster.mongodb.net/database?retryWrites=true&w=majority`
  - Get this from your MongoDB Atlas dashboard or MongoDB cluster settings
- **MONGO_DB** (optional): Database name (if not specified in MONGO_URI)
- **PORT** (optional): Server port (defaults to 3000)
- **WEATHER_API_KEY** (optional): API key for weather service

### Deployment Platforms

The application is ready for deployment on platforms like:
- **Heroku**: Set environment variables in the dashboard
- **Vercel**: Add environment variables in project settings. The `api/server.js` shim exposes the Express app as a Serverless Function and `vercel.json` rewrites all requests to it. Static assets now live under `public/`, which the Express server serves directly (and Vercel bundles via `includeFiles`), so deploy the `public` directory along with the API files.
- **Railway**: Configure environment variables in the dashboard
- **Render**: Set environment variables in the service settings
- **AWS/Google Cloud/Azure**: Configure via your platform's environment variable system

### MongoDB Atlas Setup

1. Create a MongoDB Atlas cluster (free tier available)
2. Create a database user with read/write permissions
3. Add your server's IP address to the IP whitelist (or use `0.0.0.0/0` for all IPs)
4. Get your connection string from the "Connect" button
5. Set the `MONGO_URI` environment variable with your connection string

### Health Check

The application includes a health check endpoint at `/api/ping` that verifies MongoDB connectivity. This is useful for monitoring and load balancer health checks.

### GitHub Pages Deployment (Frontend Only)

If you're deploying the frontend to GitHub Pages (static hosting), you need to:

1. **Deploy the API server separately** to a platform that supports Node.js (Heroku, Railway, Render, etc.)
2. **Configure the API URL** in `public/index.html`:
   - Open `public/index.html` and find the script section at the top
   - Uncomment and set the `window.API_BASE_URL` line:
     ```javascript
     window.API_BASE_URL = 'https://your-api-server.herokuapp.com';
     ```
3. **Enable CORS on your API server** - The server already includes CORS support for GitHub Pages

**Example setup:**
- Frontend: `https://pilon2020.github.io/HeatCoach/` (GitHub Pages)
- Backend: `https://heatcoach-api.herokuapp.com` (Heroku/Railway/etc.)
- Set `window.API_BASE_URL = 'https://heatcoach-api.herokuapp.com'` in `public/index.html`

### Notes

- The application automatically creates necessary database indexes on startup
- Data migration from local JSON files only runs if the `data/` directory exists (skipped in production)
- The MongoDB connection includes automatic retry logic and connection pooling for production reliability
- If you see `database unavailable` responses from `/api/*`, verify that your MongoDB Atlas cluster allows access from Vercel (add `0.0.0.0/0` or the deployment's egress IPs) and that `MONGO_URI`/`MONGO_DB` are set in the Vercel project settings
- CORS is configured to allow requests from GitHub Pages and localhost by default
- For production, you can restrict CORS origins using the `ALLOWED_ORIGINS` environment variable (comma-separated list)
- The `/api/auth/register` and `/api/auth/login` endpoints validate credentials directly against MongoDB so fresh browsers and new devices can onboard without any local cache
