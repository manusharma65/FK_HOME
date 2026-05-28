# FK Home — Railway deployment
# ----------------------------------------------------------------------------
# We use a Dockerfile (not Railpack/Nixpacks) because we need postgresql-client
# installed in the runtime image so the r0.8 backup engine can run pg_dump.
# Railway auto-detects the Dockerfile and uses it instead of the builder.
# ----------------------------------------------------------------------------

FROM node:18-bookworm-slim

# Install postgresql-client (provides pg_dump, pg_restore, psql) + ca-certs.
# We pull the explicit client-18 from the PostgreSQL Apt Repository because
# Debian bookworm-slim's default postgresql-client is too old to dump
# Railway's Postgres 18 server. Client version must be >= server version.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      curl gnupg ca-certificates lsb-release \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-18 \
 && apt-get purge -y --auto-remove curl gnupg lsb-release \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node deps first (cached layer when package files don't change)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

# Copy the rest of the app
COPY . .

# Railway sets PORT at runtime; we just expose it for clarity
EXPOSE 8080

CMD ["node", "server.js"]
