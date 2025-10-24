# Leaderboard API Reference

The project exposes a JSON leaderboard endpoint at `/api/leaderboard`.

## Rate limiting

Requests are throttled using a sliding window limiter. By default a client may
make up to **30** requests in a **60 second** window, as configured in
`config/settings.json` (`leaderboard.rateLimit.windowSeconds` and
`leaderboard.rateLimit.maxRequests`). Submissions are tracked per IP address and
game identifier, so hitting the limit for one game does not block submissions
to another. When the limit is exceeded the API returns `429 Too Many Requests`
with an error message describing the limit and an `identifier` field showing the
rate limited key (`<ip>:<game>` for submissions).

## GET `/api/leaderboard`

Returns the high scores for a game. Query parameters:

- `game` (required): Game identifier.
- `limit` (optional, default 10): Maximum number of scores.

Successful responses contain `{ "scores": [...] }`.

## POST `/api/leaderboard`

Submits a score for a game. The JSON payload must include:

- `game` (string)
- `score` (number)

Optional fields:

- `handle` (string)
- `share` (boolean)

On success the endpoint returns `201 Created` with `{ "submitted": {...} }`. If
the submission would exceed the configured rate limit the response is `429 Too
Many Requests` with an explanatory `error` message.
