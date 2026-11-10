# Deprecation notice: Kazi Connect job list, version 1

To: Ujuzi sub team        From: Mark Bruce Nyangena, Kazi Connect sub team (Integration/QA Lead)        Date: 10 November 2026

## Summary

Version 1 of Kazi Connect's job list, `GET /api/jobs` (Endpoints 1 and 2), is deprecated. Version 2, `GET /api/v2/jobs`, is live now. Version 1 will stop working at **midnight Nairobi time at the end of Tuesday 10 November 2026** (`Tue, 10 Nov 2026 21:00:00 GMT`). Please move before then.

That date is the course rule (no later than the day before Demo Day). As the course also says, version 1 keeps answering until after Demo Day, so **nothing of yours breaks at the demo** if you have not moved by then.

## What is changing

* The list is wrapped: `[ ... ]` becomes `{ "data": [ ... ], "count": N }`
* The address gains a version: `/api/jobs` becomes `/api/v2/jobs`
* Nothing else changes: the same `status`, `county` and `category` query parameters, the same jobs with the same fields (`id`, `title`, `category`, `county`, `area`, `duration`, `urgent`, `status`, `payRange`) in the same order, the same empty `400` for a query that is not valid, the same API key (`X-API-Key`), and every other endpoint (applications, status, the WebSocket) exactly as today

## Why

Wrapping the list now lets us add paging later (a page number, a next link) without a second breaking change, as the number of jobs grows with Event work.

## Before and after

```
v1  GET /api/jobs?status=active
    [ { "id": "job_12345", "title": "Campus Housing Assistant", "category": "accommodation", "county": "Nairobi",
        "area": "Parklands", "duration": "Part time, 3 months", "urgent": true, "status": "active",
        "payRange": { "min": 15000, "max": 22000 } } ]

v2  GET /api/v2/jobs?status=active
    { "data": [ { "id": "job_12345", "title": "Campus Housing Assistant", "category": "accommodation", "county": "Nairobi",
                  "area": "Parklands", "duration": "Part time, 3 months", "urgent": true, "status": "active",
                  "payRange": { "min": 15000, "max": 22000 } } ],
      "count": 1 }
```

No matches is `{ "data": [], "count": 0 }`, not a 404.

## How to migrate

All of it is in one function, `listActiveJobs` in your `lib/clients/kaziClient.ts`:

1. Line 70: call `/api/v2/jobs?` instead of `/api/jobs?`. Same key, same query.
2. Line 74: check the wrapper instead of a bare list: `if (answer.status !== 200 || !isObject(answer.body) || !Array.isArray(answer.body.data))`
3. Line 75: read the list from `answer.body.data` instead of `answer.body`.
4. Regenerate your copy of our contract (`partner-tests/kazi_openapi.yaml`, version 1.4.0, from `https://kaziconnect1-1xmu.onrender.com/openapi.yaml`): it adds the `JobList` schema.
5. Test it, then tell me, so I can see your calls move from `GET /api/jobs` to `GET /api/v2/jobs` in our `/api/stats`.

Until you move, every answer from `/api/jobs` also carries these headers, so your code can see the change coming:

```
Deprecation: true
Sunset: Tue, 10 Nov 2026 21:00:00 GMT
Link: </api/v2/jobs>; rel="successor-version"
```

## Timeline

* 10 November 2026: v2 is live; v1 still works and now sends the three headers
* Tuesday 10 November 2026, midnight Nairobi time: v1's sunset (it keeps answering until after Demo Day)

## Questions

Message me any time. I will reply the same day. Please reply when you have read this, so I know it arrived.
