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
| `ring_check_output.txt` | The output of the four ring checks, run on the local ring on 14 November 2026 (Kazi Connect `ring:status` and `ring:check`, Sherehe `ring:e2e`, Ujuzi `ring:check`), all passing |
| `1_event_openings.png` to `6_accepted_over_websocket.png` | One screenshot per step, taken on the same local ring straight after the checks |

## Screenshots, taken on the local ring on 14 November 2026

All seven files below were made on 14 November 2026 between 23:38 and 23:52 EAT, with the three projects running together on one computer (Sherehe on port 4001, Kazi Connect on 4002, Ujuzi on 4003), each calling the next with a key made for that run only. They were not taken on Render. Every screenshot is of the real pages of the three projects; nothing was drawn in or changed. The only work done on them was cropping, placing two views of the same moment together, and adding the caption bar on top. To repeat them on the live systems, follow `LIVE_RUNBOOK.md`.

The test data was made for this run: an organiser account, the event evt_2010 "Ring demo: Westlands wedding (local test)" and its role rol_3016 "Ushers and registration" on Sherehe. On Ujuzi the seeded graduate Achieng Otieno (grd_0101) applied through the course "Event setup and guest service". A first attempt on a similar test event ("Ring demo wedding (local test)") was accepted before its Sherehe screenshot was saved, so the run was repeated on a fresh event. That earlier role and job still show in screenshots 1, 3 and 4, next to the ones from the run.

| File | Step | What it shows | Status |
|---|---|---|---|
| `1_event_openings.png` | 1 | Kazi Connect's Event work page reads Sherehe's upcoming events and open roles in Nairobi with Kazi Connect's key, including the test role (Endpoint 22; K1, K2) | Taken 14 November 2026, local ring |
| `2_staffing_offer_pending.png` | 2 | The employer offers 2 workers; the offer is `pending` on Kazi Connect and the same offer waits on Sherehe for the organiser, with Accept and Decline (Endpoint 23; K3) | Taken 14 November 2026, local ring |
| `3_offer_accepted_job_opened.png` | 3 | The organiser accepts on Sherehe (2 of 4 confirmed); on its next check Kazi Connect shows `accepted` with job `job_12355` (Endpoint 24; K4), and the job is in the public job list for Events in Nairobi (Endpoint 1) | Taken 14 November 2026, local ring |
| `4_ujuzi_reads_job.png` | 4 | Ujuzi's course page lists that job, read from Kazi Connect's job list filtered by category and county (Endpoint 1; U1, U2). Ujuzi does not call Endpoint 3, so U3 is not shown | Taken 14 November 2026, local ring |
| `5_ujuzi_applies.png` | 5 | Ujuzi applies for the graduate with its own ID `grd_0101` as `studentId` (Endpoint 7; U4); the employer sees application `app_1008` from `grd_0101` | Taken 14 November 2026, local ring |
| `6_accepted_over_websocket.png` | 6 | The employer accepts; Ujuzi's page, left open and not reloaded, changes to `accepted` within seconds (Endpoint 6 WebSocket; U5). Kazi Connect's log shows no request from Ujuzi for that application after the accept, so the change came over the WebSocket, not Ujuzi's 2 minute backup poll | Taken 14 November 2026, local ring |
| `ring_check_output.txt` | all | The output of the four ring checks on the same ring and day | Done 14 November 2026, local ring |

Run `npm run ring:status` first on the day: it says which systems are ready, so a missing part is not mistaken for a fault.
