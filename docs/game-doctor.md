# Game Doctor

`tools/game-doctor.mjs` performs consistency checks on `games.json` and the on-disk assets each game references.

## Running the doctor

```bash
npm run doctor
```

The command generates `health/report.json` and `health/report.md` summaries. Use `--strict` (enabled in the npm script) to fail the run when new issues are introduced.

## Schema validation

Before any other check runs, Game Doctor validates `games.json` against [`tools/schemas/games.schema.json`](../tools/schemas/games.schema.json).

The schema enforces:

- required catalog fields (`id`, `slug`, `title`, `playUrl`, `firstFrame.sprites`, `help.tips`, etc.)
- canonical formats (e.g. IDs/slugs are lowercase-hyphenated, `playUrl` ends with `/games/<slug>/`, ISO `released` dates, asset paths under `/assets/`)
- no unexpected top-level, `firstFrame`, or `help` properties

If validation fails you will see output similar to:

```
games.json failed schema validation:
 - [3] › playUrl: value does not match required pattern "^/games/[a-z0-9-]+/$"
 - [5] › help › tips: missing required property "0"
```

Interpret the path using `›` separators. For example, `[3]` refers to the fourth game entry. Fix the offending values in `games.json` until validation passes, then re-run the doctor.

Once the schema passes, the tool continues with asset availability checks, manifest enforcement, and regression comparisons.
