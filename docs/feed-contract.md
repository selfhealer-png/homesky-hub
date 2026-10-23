# Agenda feed contract (v1)

The hub reads calendar events and tasks from any HTTP endpoint that returns this JSON. The endpoint is called server-to-server by the hub's Worker:

```
GET <AGENDA_FEED_URL>?days=7
Authorization: Bearer <AGENDA_FEED_TOKEN>
```

Respond `200` with `Content-Type: application/json`:

```json
{
  "version": 1,
  "generatedAt": "2026-10-23T09:00:00Z",
  "timezone": "Europe/London",
  "sources": [
    { "id": "family", "name": "Family", "color": "#475569" }
  ],
  "events": [
    {
      "id": "abc123",
      "source": "family",
      "title": "Dentist",
      "start": "2026-10-24T09:30:00+01:00",
      "end": "2026-10-24T10:00:00+01:00",
      "allDay": false,
      "location": "High Street"
    },
    {
      "id": "def456",
      "source": "family",
      "title": "Half term",
      "start": "2026-10-26",
      "end": "2026-10-31",
      "allDay": true
    }
  ],
  "tasks": [
    {
      "id": "t1",
      "source": "family",
      "title": "Renew car insurance",
      "due": "2026-10-22",
      "done": false
    }
  ]
}
```

## Rules

* `start`/`end`: ISO 8601. All-day events use plain dates, with `end` **exclusive** (same as Google Calendar).
* `source` refers to an entry in `sources`. The hub uses its `color` for the event's accent.
* Tasks without `due` are shown as "anytime". Tasks whose `due` is before today are shown as overdue.
* Optional fields: `location`, `end` (for tasks it's ignored), `done` (default `false`; done items may simply be left out).
* Unknown fields are ignored, so producers can add things freely.
* **The producer decides what's safe to show.** The hub displays everything it receives on a screen in a shared room.
* Return `401` for a missing or wrong token. Never let an unset token on the producer side match `Bearer undefined`.
