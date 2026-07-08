# SWAGGER-DOCUMENTATION-GUIDE

## Purpose

How Swagger/OpenAPI is set up and how to keep it accurate.

## When to read

Whenever you add or change an endpoint, DTO, or response model.

## Keep updated

- When the Swagger setup or annotation convention changes.

## Setup

Configured in `src/main.ts` via `DocumentBuilder`/`SwaggerModule`: title "Havit - Fitness API", tags `Auth`, `Users`, `Challenges`, `Exercises`, `Routine`, `Metrics`, `Workout Logs` (one per module, add a new tag here when adding a module with its own controller), `addBearerAuth()` for JWT. Served at `GET /api-docs`. `addServer(publicApiUrl)` defaults to `http://20.63.84.1:3000`, overridable via `PUBLIC_API_URL` env var. A checked-in snapshot lives at `backend/swagger.json` — regenerate by hand (no scripted export exists) when the contract changes meaningfully.

## Annotation conventions

- `@ApiTags('<Tag>')` on the controller class, matching one of the tags registered in `main.ts`.
- `@ApiOperation`, `@ApiResponse`/`@ApiOkResponse` per route.
- `@ApiBearerAuth()` on protected routes (paired with `@UseGuards(JwtAuthGuard)`).
- `@ApiParam` for path params where useful.
- DTO fields are not consistently annotated with `@ApiProperty` across all DTOs today — add it on new/changed fields even where older DTOs are missing it, don't propagate the gap.

## Generating the spec

No automated export script exists. To refresh `backend/swagger.json`: run the app locally/in Docker, fetch the generated document (e.g. `GET /api-docs-json` or the `/api-docs` UI's "download" if exposed), and save it over `backend/swagger.json`.

## Checklist when changing an endpoint

- [ ] DTOs annotated with `@ApiProperty` on new/changed fields.
- [ ] `@ApiOperation`/`@ApiResponse` describe the endpoint.
- [ ] `@ApiBearerAuth` declared if the route is guarded.
- [ ] `backend/swagger.json` refreshed if the change is meaningful for frontend integration.
- [ ] Updated `BACKEND-INTEGRATION-GUIDE.md`.

> Must reflect the real current Swagger setup, not assumptions.
