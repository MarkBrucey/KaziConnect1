# Blind Test Report: Week 8

## 1. What happened when our README was tested

**The blind test has not happened yet.** No team outside our ring was available during the lab, so on 13 October 2026 we sent our README link to another team by message, with no explanation beyond asking them to follow it and report back. No reply had arrived by the deadline, so no outside reader has tried our README yet. We have no blind test result to report: no success, no failure and no time taken.

## 2. What we checked instead, and what we fixed

This is not a substitute for a blind test, because we wrote the README and know the API. We did the next best thing the handout suggests: we followed our own README literally, exactly as written, from clean environments with nothing set up, and fixed every place where a literal copy and paste failed or could mislead.

What we ran, all exactly as written:

* Every bash command in Walkthrough A, in order, from a clean shell, against the live API. All 22 command blocks returned the status codes the README promises.
* Every PowerShell block in Walkthrough B, in one PowerShell 7 session, against the live API. All passed.
* The "run it on your own computer" steps from a fresh `git clone` of this repository: `npm install`, `npm start`, the docs page, `npm test` (156 passed) and `npm run verify` (44 of 44).
* The docs page at https://kaziconnect1-1xmu.onrender.com/docs: all 21 endpoints render, each with a request shape and a response shape.

What these checks caught and we fixed today:

1. **The clone command was a placeholder** (`git clone PASTE_THE_ADDRESS_HERE`), which fails if copied literally. It is now the real command.
2. **Every reader would have left a test job open on the live site**, filling the public listings with copies of the example job. The walkthrough now ends by closing the reader's own job.
3. **The live updates endpoint showed no response shape** on the docs page. It now shows the message it sends.
4. **The docs' Authorize box lost a word** (`<token>` was hidden as code), so it read "Bearer ." It now says what to paste.
5. **Windows readers had no working path for most commands**: multi-line curl fails in Command Prompt. We added a PowerShell walkthrough and a table saying which terminal to use.
6. **An empty error body was easy to miss.** Read endpoints answer 404 with no body, so we added a note pointing at it.
7. **`npm install` prints a vulnerability warning** that could alarm a stranger. We explained it: all the warnings are inside the testing tool, and the server itself has none.

## 3. Honest summary

No outsider has tested our README yet, so we cannot claim it works for a stranger, which is the claim this week checks. What we can say is narrower: every command in it works exactly as written when we run it from scratch, and today's self-checks found and fixed seven problems a stranger would likely have hit. The questions only a real reader can answer remain open: whether the walkthrough order is clear, whether the token and ID steps make sense to someone new, and how long the first working request takes. We will run the swap as soon as a team replies, and update this report with exactly what happened, including where they got stuck and if it didn't work.
