# Updating the status page

The status page is at https://www.oneplustwo.co.uk/status. Everything on it comes from one file:

    assets/data/status.json

Edit that file on GitHub (open it, click the pencil icon, make your change, then "Commit changes"). Vercel publishes it within a minute or so. You don't need to change anything else.

When anything isn't "All systems operational", a small coloured bar also appears at the top of every page on the website, linking to the status page. It disappears again once everything is back to normal.

## 1. Service statuses

Each service has a `status`. Use one of these exactly:

| Value | Shows as |
|---|---|
| `operational` | Operational (green) |
| `degraded` | Degraded performance (amber) |
| `partial_outage` | Partial outage (orange) |
| `major_outage` | Major outage (red) |
| `maintenance` | Under maintenance (blue) |

## 2. Posting an incident

Add an entry to `incidents` (newest first). Example:

```json
"incidents": [
  {
    "title": "Online orders delayed",
    "status": "investigating",
    "impact": "major",
    "components": ["Online ordering websites"],
    "updates": [
      { "time": "2026-10-22T12:10:00+01:00", "status": "investigating", "message": "We're looking into reports of delayed online orders." }
    ]
  }
]
```

- `status`: `investigating`, `identified`, `monitoring` or `resolved`.
- `impact`: `minor` (amber) or `major` (red).
- To post an update, add another line to `updates` and change the incident's `status`. Updates show newest first.
- When it's fixed, set the incident's `status` to `resolved`, add a final update, and set the affected services back to `operational`. Resolved incidents stay listed under "Past incidents" (the 10 most recent are shown); delete old ones whenever you like.
- Times use the format `YYYY-MM-DDTHH:MM:SS+01:00` (use `+01:00` in British Summer Time, `+00:00` in winter).

## 3. Planned maintenance

```json
"maintenance": [
  {
    "title": "Back office upgrade",
    "status": "scheduled",
    "start": "2026-12-01T02:00:00+00:00",
    "end": "2026-12-01T04:00:00+00:00",
    "components": ["Back office and reports"],
    "message": "Reports may be unavailable for up to 2 hours."
  }
]
```

It shows under "Planned maintenance" until the end time passes (or you set `status` to `completed`). The alert bar on the rest of the site appears from 24 hours before it starts.

## 4. Last updated

Change `updated` at the top of the file to the current time whenever you make a change.

## Tips

- Keep commas and quote marks exactly as in the examples. If the page shows "We couldn't load the latest status", the file has a typo: paste it into https://jsonlint.com to find it.
- Service names in `components` should match the names in the services list.
