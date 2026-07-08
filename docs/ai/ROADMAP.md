# ROADMAP

## Purpose

What is planned but not yet built, and roughly in what order. Helps align new work with intended direction and avoid premature or conflicting designs.

## When to read

When planning a new feature or deciding how far a change should go.

## Keep updated

- When a planned item is started (move it to CURRENT-STATE) or completed.
- When priorities change or new items are planned.

## Now / Next / Later

No formally tracked sprint/priority order exists beyond `backend/README.md`'s "Próximos pasos" list. Treat the items below as backlog, not a committed order — confirm priority with whoever assigns the task.

### Next
- Community features between users (`user_follows`, feed-style social interaction) — DB schema exists (`user_follows`, `workout_post_likes`), no backend module yet.
- Push notifications — `notifications`/`notification_types` tables exist, no delivery mechanism or backend module yet.

### Later
- Advanced progress metrics/analytics.
- Group chat (`spaces`, `space_members`, `space_messages`) and direct messaging (`direct_conversations`, `direct_messages`) — schema exists, no backend module yet; frontend has placeholder routes/components for both (`app/messaging/`, `app/notifications.tsx`).
- A response envelope / pagination convention, once list endpoints (challenges, exercises, feed) need it.

## Out of scope

- Multi-tenancy (business/branch isolation) — not a fit for a single-tenant consumer fitness app; don't design toward it.

> This document must reflect the real current plan, not assumptions.
