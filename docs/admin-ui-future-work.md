# Admin UI follow-up ideas

## Expand editable metadata
The form only exposes title, description, emoji, tags, and boolean flags, while other fields (such as the slug `id`, launch `path`, thumbnail, and `addedAt`) are rendered as static text. 【F:admin/index.html†L86-L143】 This makes it hard to correct paths, backfill publish dates, or swap thumbnails without dropping into the raw JSON textarea. Adding dedicated inputs — along with affordances like file pickers for thumbs or calendars for dates — would keep maintainers in the structured editor for more tasks.

## Add search and bulk actions for the game list
`renderList` builds a vertical stack of every entry with no way to filter, sort, or apply the same flag to multiple games. 【F:admin/index.html†L62-L118】 As the catalog grows, a search box, tag filters, or even multi-select checkboxes with batch toggles (e.g., mark several items as `featured`) would speed up moderation.

## Smooth out ZIP import flows
When a ZIP is dropped, the tool assumes the folder name should become the permanent `id`, instantly writes an entry, and only offers preview/close controls on the resulting card. 【F:admin/index.html†L173-L295】 Providing rename/remove buttons, surfacing validation warnings inline, and warning about overwriting existing slugs before erasing them would make it safer to iterate on builds.

## Harden load/save actions
The "Load games.json" button fetches the file once and only reports success via `alert`, while download/export handlers optimistically serialize the current textarea state. 【F:admin/index.html†L167-L171】【F:admin/index.html†L297-L299】 Wrapping these flows in try/catch blocks, showing inline status banners, and disabling buttons while work is in progress would make failures (e.g., network errors or malformed JSON) more visible and reduce accidental duplicate clicks.

## Replace the shared key gate with real auth
Every control stays hidden until `?key=letmein` is present, but once the query string is known, anyone can manage the catalog. 【F:admin/index.html†L300-L301】 Introducing proper authentication (Netlify/Cloudflare access, Basic Auth, or an OAuth-protected dashboard) plus audit logging would protect the CMS from casual discovery.
