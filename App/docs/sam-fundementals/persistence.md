# Persistent Storage with Supabase

## When You Need This

**For local CLI development (`uv run sam run configs/`):** You likely don't need this. SQLite files persist on your local filesystem, so chat history and agent state survive restarts automatically.

**For Docker or cloud deployments (Railway, etc.):** Read on. Container restarts lose SQLite data unless you configure external storage or mount volumes.

## Default Behavior

- **Session/state data** is stored in SQLite, which is lost on container restarts unless explicitly persisted (e.g., via volume mounts)
- **Artifacts** are stored in-memory and always lost on restart—S3-compatible storage is required to persist them

For full persistence without managing volumes, use Supabase (free tier: 500MB PostgreSQL + 1GB S3).

## 1. Create a Supabase Account

Go to [supabase.com](https://supabase.com) and create a free account.

## 2. Get Your Database Connection String

Most deployment platforms require IPv4 connections. Use Supabase's **Session pooler** (not direct connection):

1. Supabase Dashboard → **Settings** → **Database**
2. Under **Connection string**, select **Session pooler** method
3. Copy the connection string
4. Replace `[YOUR-PASSWORD]` with your database password

> **Note:** The pooler hostname varies by project (e.g., `aws-0-us-east-1.pooler.supabase.com`). Always copy directly from your dashboard.

## 3. Create Databases for SAM Components

SAM's WebUI and agents have separate database migrations that conflict when sharing one database. Create two databases:

```bash
# Replace with your Session pooler connection string
# URL-encode special chars in password (e.g., ! = %21, @ = %40)
docker run --rm postgres:18 psql "postgresql://postgres.PROJECT:PASSWORD@POOLER-HOST:5432/postgres" \
  -c "CREATE DATABASE sam_webui; CREATE DATABASE sam_agents;"
```

## 4. Configure Database Environment Variables

Set `PERSISTENCE_TYPE=sql` and add database URLs to your environment:

```env
PERSISTENCE_TYPE=sql

# WebUI Gateway
WEB_UI_GATEWAY_DATABASE_URL=postgresql+psycopg2://postgres.PROJECT:PASSWORD@POOLER-HOST:5432/sam_webui

# Orchestrator + Custom Agents (can share)
ORCHESTRATOR_DATABASE_URL=postgresql+psycopg2://postgres.PROJECT:PASSWORD@POOLER-HOST:5432/sam_agents
CUSTOM_AGENT_DATABASE_URL=postgresql+psycopg2://postgres.PROJECT:PASSWORD@POOLER-HOST:5432/sam_agents
```

> **Note:** Use `postgresql+psycopg2://` prefix for SAM compatibility. Replace `POOLER-HOST` with your Session pooler hostname from Supabase (e.g., `aws-0-us-east-1.pooler.supabase.com`).

## 5. (Optional) Enable S3 Artifact Storage

For persistent file/artifact storage:

1. Supabase Dashboard → **Storage** → Create bucket `sam-artifacts`
2. Go to **S3 Connection** to get credentials
3. Add these variables to your environment:

```env
ARTIFACT_SERVICE_TYPE=s3
S3_BUCKET_NAME=sam-artifacts
S3_ENDPOINT_URL=https://PROJECT.storage.supabase.co/storage/v1/s3
S3_REGION=<from Supabase S3 Connection page>
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
```

> **Note:** Get all S3 values from Supabase Dashboard → Storage → S3 Connection. The region varies by project.

## What Gets Persisted

| Data              | Default                 | With Volume Mount | With Supabase          |
| ----------------- | ----------------------- | ----------------- | ---------------------- |
| Chat history      | Lost on restart         | Persisted         | Persisted (PostgreSQL) |
| Agent state       | Lost on restart         | Persisted         | Persisted (PostgreSQL) |
| Artifacts (files) | Always lost (in-memory) | Still lost\*      | Persisted (S3)         |

\*Artifacts require S3-compatible storage regardless of volume mounts.
