# Backend Service Boilerplate

A minimal, production-ready **Node.js backend boilerplate** built with **Express**, **TypeScript**, and **PostgreSQL**.

This repository is intended as a **generic backend foundation** and is not tied to any specific domain or project.

---

## Tech Stack

- Node.js
- Express
- TypeScript
- PostgreSQL (`pg`)
- Winston (logging)
- node-pg-migrate (database migrations)

---

## Project Structure (High Level)

```
src/
├── app.ts          # Express app setup
├── server.ts       # Server bootstrap
├── routes/         # HTTP routes
├── middleware/     # Middleware (auth, cors, etc.)
├── db/             # Database connection & utilities
├── logger/         # Winston logger setup
└── config/         # Environment & config helpers

migrations/         # Database migrations (JavaScript)
logs/               # Local application logs (gitignored)
```

---

## Logging

- Logging is handled using **Winston**
- Logs are written to the local `logs/` directory
- Intended for local development and basic operational visibility
- Can be extended later for structured logging or external log aggregation

---

## Scripts

```bash
npm run dev       # Run server in development mode
npm run build     # Build TypeScript into dist/
npm start         # Run compiled server
```

### Database Migrations

```bash
npm run migrate:create <name>   # Create a new migration
npm run migrate:up              # Run pending migrations
npm run migrate:down            # Roll back last migration
```

---

## Environment Variables

See `.env.example` for required environment variables, including:

- Server configuration
- CORS configuration
- PostgreSQL connection details

---

## Health Endpoint

The service exposes a basic health endpoint:

```
GET /health
```

This endpoint returns:

- Application status
- Uptime
- Basic system metrics
- PostgreSQL connectivity status

Intended for local checks, monitoring, and readiness probes.

---

## Notes

- This boilerplate is designed to be **simple, explicit, and extensible**
- No domain-specific logic is included
- Database schemas are managed exclusively via migrations
- Migrations are written in **plain JavaScript** for reliability and simplicity

---

## Intended Usage

Use this repository as a starting point for:

- API services
- Internal tools
- Backend services requiring Postgres
- Systems that prioritize auditability and operational clarity

---
