# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-08-05

Patch release; no breaking changes.

### Added

- `GET /tags` — browse the tags used across a workspace's articles with their usage counts,
  paginated. Feeds the tag filter on `GET /articles`.
- `PATCH /articles/:id/status` — general status transition endpoint covering the whole workflow
  (`draft` / `published` / `archived`) instead of a single-purpose action route. The publication
  date is stamped on the first transition into `published` and preserved afterwards, so an
  archive → publish round-trip keeps the original date.
- `archived` article status, accepted by `POST /articles` and by the `?status=` list filter.

## [0.1.0] - 2026-07-28

### Added

- Initial articles + comments CRUD API, workspace-scoped, with Zod validation at the route edge
  and a shared error envelope.
