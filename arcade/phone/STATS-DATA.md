# Detailed activity data integration

The UI in details.js is a design surface. `preview=1` labels illustrative data; the normal screen displays unavailable values as dashes. It does not read another device's localStorage or imply that session history is already synced. All-time summaries and daily charts must remain separate.

## Existing sources, inspected

| Source | Available now | Persistence / required work |
| --- | --- | --- |
| games/subway/stats.js | Runs, metres, kcal, coins, jumps, squats, seconds, bestMetres, bestKcal, last timestamp | arcade.stats.v1 on host. byGame stores runs/metres/kcal/seconds/bestMetres, but NOT coins/jumps/squats. No dated run history. |
| games/subway/game.js | End-of-run statistics, current level, collision/end context | recordRun stores only totals above; capture result and level in session record. |
| games/squid/{track,red-light,jump-rope}/game.js | Games, wins, metres, kcal, jumps, squats | Shared squid.stats.v1 aggregate, without per-game split. Record a game ID and separate sessions before presenting per-game totals. |
| Track game runtime | Finish time/place, laps, me.cleared, me.hit, personal best | Save result fields in session snapshot; don't infer cleared hurdles from jump counts. |
| Red Light runtime | Clock, progress, distance to finish, elimination reason, prize pot | Save final snapshot; stop reaction times and freeze-success rates would require new timestamped events. |
| Jump Rope runtime | Clock, progress, jumps, outcome, prize pot | Save final snapshot; timing accuracy would require explicit rope phase and event timestamps. |
| engine/calories.js | kcal, active, jumps, squats, seconds, kg | Active energy and kg are runtime values, currently discarded by the summary recorder. Record baseline, cadence, jump and squat components for each session. |
| engine/pocket.js poll() | events, ready, live, running, steady, cadenceHz, v, tilt, aG, wDps | Runtime on host. Record events and sampled aggregates; step count should count step events, not integrate cadence as if measured steps. |
| engine/profile.js | walk/jog/sprint cadence, stillness, stop time, hop and squat calibration | arcade.profile.v1 on host. Sync selected profile metadata explicitly. |
| phone.js | rateEst, rtt, sent, gravityMode, wake lock, browser mode | Phone-local runtime; can publish a throttled snapshot while visible. Do not start sensors simply to open stats. |
| engine/lib/protocol.js | timestamp, acceleration XYZ, gravity XYZ, rotation XYZ; findGaps(), measuredHz(), ClockSync | Gap and rate calculations require samples. Capture missing/unsupported channels as null rather than zero. |

## Meaning of the measurements

- Calories: MET × 3.5 × kg / 200 per minute. Standing = 1.3 MET; cadence <=2 Hz = 4; 2.7 Hz = 8; 3.3+ Hz = 11.5, interpolated between the moving bands. Default mass = 70 kg.
- Jump addition = 0.0033 × kg kcal; squat addition = 0.0045 × kg kcal. These are model assumptions, not individually measured effort.
- Active kcal excludes standing energy. Total = active + standing. Store unrounded values; round only for display.
- Subway distance uses cadence × modeled step length × time in games/subway/runspeed.js. Squid uses its own pace model. Neither is GPS distance. Keep course progress separate from estimated physical distance.
- Vertical movement `v` is a detector signal, not measured jump height. Tilt is phone tilt, not joint angle or squat depth.
- No heart rate, oxygen saturation, GPS routes, elevation/floors, or clinical calorie accuracy is measured.

## Proposed versioned session payload (not implemented)

Use `activity.session.v1` with sessionId, gameId, startedAt, endedAt, inputMode, preview flag and outcome; movement {steps, jumps, squats, estimatedMetres, activeSeconds, stillSeconds, cadenceMeanHz, cadencePeakHz}; energy {totalKcal, activeKcal, standingKcal, jumpKcal, squatKcal, cadenceActiveKcal, kg, weightSource, modelVersion}; game-specific result; sensorQuality {sampleCount, deliveredHz, rttMs, gapCount, longestGapMs}; calibration version. Unknown values must be null.

Record on the host once per session, exclude developer previews and distinguish keyboard runs. Deduplicate by sessionId, persist bounded history, and send snapshots/deltas through the existing relay. History must use explicit date boundaries and timezone for D/W/M aggregation. A new detail screen should consume structured numeric payloads; the existing `scene.you.stats` contains formatted strings and is insufficient for arithmetic. Store sensor summaries and event timestamps by default, rather than retaining unlimited raw motion samples.

Verify reconciliation: game totals equal period totals, active plus standing equals total, kcal components add up, previews never persist, duplicate messages do not inflate totals, empty/disconnected states remain explicit, unsupported sensors remain null.
