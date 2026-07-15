# INDEX — AI Documentation Entry Point

## Purpose

The single entry point for any Claude Code session working in `backend/`. It explains what this repo is and links to every other AI doc, in reading order.

## When to read

**First, always.** Before any task in this repo.

## Keep updated

- Whenever a new doc is added under `docs/ai/`.
- Whenever the repo's scope or one-line summary changes.

## What this repo is

The Havit backend: a NestJS + TypeORM + PostgreSQL REST API for a fitness/challenges app. Users authenticate, join challenges, follow routines, log daily workout progress, and post evidence photos. It is its own independent git repository (not part of a monorepo — see the root [`CLAUDE.md`](../../../CLAUDE.md)), deployed as a Docker container against a shared Azure Database for PostgreSQL instance.

## Reading order

1. [ARCHITECTURE.md](./ARCHITECTURE.md) — structure and rationale.
2. [CURRENT-STATE.md](./CURRENT-STATE.md) — what exists and its status.
3. [SECURITY.md](./SECURITY.md) — auth/ownership model, current security gaps, secure-endpoint checklist. **Read before touching any endpoint.**
4. [MAP.md](./MAP.md) — where things live.
5. [CHANGES.md](./CHANGES.md) — recent changes.
6. [CONVENTIONS.md](./CONVENTIONS.md) — how we write code here.
7. [DECISIONS.md](./DECISIONS.md) — why things are the way they are.
8. [ROADMAP.md](./ROADMAP.md) — what's planned.
9. [TASKS-LOG.md](./TASKS-LOG.md) — completed work log.
10. [HOW-TO-ADD-A-FEATURE.md](./HOW-TO-ADD-A-FEATURE.md) — end-to-end walkthrough (DB → entity → module → endpoint → service → frontend → tests) for adding a feature.
11. [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — common failures and fixes.

## Specialized docs

- `backend/` subfolder — API-specific docs (module layering, routes, domain model, Swagger, [error handling](./backend/ERROR-HANDLING.md), [testing](./backend/TESTING-GUIDE.md)). Read via the `app-builder-backend` skill.
- `db/` subfolder — database/migration docs. Read via the `app-builder-db` skill. The mandatory gate file for any DB change is [`../../database/DB-INSTRUCTIONS.md`](../../database/DB-INSTRUCTIONS.md).

> This index must reflect the real current codebase, not assumptions.
