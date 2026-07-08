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
3. [MAP.md](./MAP.md) — where things live.
4. [CHANGES.md](./CHANGES.md) — recent changes.
5. [CONVENTIONS.md](./CONVENTIONS.md) — how we write code here.
6. [DECISIONS.md](./DECISIONS.md) — why things are the way they are.
7. [ROADMAP.md](./ROADMAP.md) — what's planned.
8. [TASKS-LOG.md](./TASKS-LOG.md) — completed work log.

## Specialized docs

- `backend/` subfolder — API-specific docs (module layering, routes, domain model, Swagger). Read via the `app-builder-backend` skill.
- `db/` subfolder — database/migration docs. Read via the `app-builder-db` skill. The mandatory gate file for any DB change is [`../../database/DB-INSTRUCTIONS.md`](../../database/DB-INSTRUCTIONS.md).

> This index must reflect the real current codebase, not assumptions.
