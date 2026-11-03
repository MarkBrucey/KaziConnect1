# Ring evidence

End-to-end demo across Sherehe, Kazi Connect and Ujuzi. Kazi takes part in steps 1-6:
1-3 Kazi reads Sherehe events and roles, makes an offer, sees it accepted; Kazi opens the job.
4-6 Ujuzi reads matching jobs, applies for a graduate, and receives "accepted" over the WebSocket.

One screenshot per step, named by step number, plus the output of `npm run ring:check`.

## What is here today

| File | What it is |
|---|---|
| `LIVE_RUNBOOK.md` | How to test the three systems on Render once they are live: what to deploy first, how to wire the keys, the checks in order from read-only to one throwaway record, the demo story, and what not to run |
| `HELD_ISSUES.md` | The errors put on hold while a partner system is not built yet, and the commands that re-check them. It says where the ring stands |

## Screenshots still to take

None of these exist yet: they need the live Sherehe and Ujuzi, which are not deployed, so nothing here has been invented or mocked up. The file names are a suggestion. When one is taken, change its row to say so and give the date.

| File | Step | What it will prove | Status |
|---|---|---|---|
| `1_event_openings.png` | 1 | Kazi Connect reads Sherehe's upcoming events and open staffing roles with the real key (Endpoint 22; K1, K2) | TODO |
| `2_staffing_offer_pending.png` | 2 | An employer offers workers for a role and the offer is `pending` (Endpoint 23; K3), and the offer exists at Sherehe | TODO |
| `3_offer_accepted_job_opened.png` | 3 | The organiser accepts on Sherehe; Kazi Connect's offer shows `accepted` with a `jobId` (Endpoint 24; K4) and the job appears in the listings (Endpoint 1) | TODO |
| `4_ujuzi_reads_job.png` | 4 | Ujuzi reads that job in its matches for a skill and county (Endpoints 1, 2 and 3; U1 to U3) | TODO |
| `5_ujuzi_applies.png` | 5 | Ujuzi applies for a graduate with its own ID (`grd_...`) as `studentId` (Endpoint 7; U4) | TODO |
| `6_accepted_over_websocket.png` | 6 | The employer accepts and Ujuzi receives `accepted` over the Endpoint 6 WebSocket (U5) | TODO |
| `ring_check_output.txt` | all | The output of `npm run ring:check`, run against the live systems on the same day | TODO |

Run `npm run ring:status` first on the day: it says which systems are ready, so a missing part is not mistaken for a fault.
