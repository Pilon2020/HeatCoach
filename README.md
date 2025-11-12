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
- **Vercel**: Add environment variables in project settings
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

### Notes

- The application automatically creates necessary database indexes on startup
- Data migration from local JSON files only runs if the `data/` directory exists (skipped in production)
- The MongoDB connection includes automatic retry logic and connection pooling for production reliability
