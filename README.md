# rs2b2t skill lab

Public XP/hour records, level-based EHP, and time-to-max estimates for rs2b2t.

**Website: https://kennybossier.github.io/rs2b2t-skill-lab-v2/**

This is an independent GitHub Pages project. It has no dependency on a local
dashboard, bot client, database, computer, private API or user credentials.
Only public rs2b2t character statistics and training-rate definitions are included.

## How it works

- GitHub Pages serves plain HTML, CSS, JavaScript and published JSON snapshots.
- Visitors search the published character roster and inspect all 19 skills.
- EHP and remaining hours use the level bands in
  [2004Tracker's rate file](https://github.com/R-Dson/2004Tracker/blob/main/data/skill_rates.json).
- Skill cards show each skill's five best observed one-hour player records,
  distinct from the rates used for calculations.
- The initial seed includes 38,704 checked historical player-days across 970
  skill/player pairs, covering the top 40 overall total-level players in all
  skills, plus per-skill contenders. Hour records are sampled, not exhaustive.
- GitHub Actions updates character snapshots every six hours, expands the
  published roster from the overall rankings, checks new historical days, saves
  resumable state in Actions cache, and republishes the site. Scheduled runs can
  be delayed by GitHub; stale data remains usable with its timestamp.

The initial publication includes saved 7-day and 30-day snapshots. The first
refresh also collects a 24-hour snapshot. Search is limited to characters present
in the chosen published window. Visitors cannot initiate server-side scans or
look up an uncollected player live; use the repository's **Publish skill lab**
workflow to request a refresh. No secret-bearing public proxy is used.

## Calculations

Exact level XP thresholds split earned/remaining XP into bands. Each band's XP
is divided by its configured rate, then hours are summed. Post-99 XP adds EHP at
the final rate, but no remaining time. Current rates are shown per character;
skill cards show the final rate and an expandable band table.

Hitpoints has no supplied rate and is treated as passive alongside combat,
adding no separate EHP or hours. Its XP and 99 status are still displayed.
Bonus XP deductions, supplies and banking are excluded. Where methods overlap,
the fastest listed method is chosen. Cooking 35–40 carries forward the preceding
rate because the source has a gap. Estimates sum training requirements; they are
not an optimized elapsed-time plan. See data/2004tracker-rates.md.

## Run locally

Install [Bun](https://bun.sh), then:

```sh
bun install
bun test
bun run typecheck
bun run build
bun run preview
```

Open the printed URL. Preview also tests the repository subpath used by Pages.
`bun run refresh` collects new public data with serial, throttled requests; this
can take a while. `state/` and `dist/` are ignored by Git. The committed `seed/`
contains only public game statistics and allows builds without upstream access.

## Deploy / update

Enable GitHub Pages with **GitHub Actions** as the publishing source. Pushing
main builds and publishes using retained data. The scheduled workflow refreshes
data every six hours. For an immediate update, run **Publish skill lab** from
Actions with **Refresh public player data** enabled. No repository secrets are
required; deployment uses the workflow's scoped GITHUB_TOKEN/OIDC permissions.
GitHub may disable schedules after prolonged repository inactivity; maintainers
can re-enable them in Actions. Cache eviction can revert to the committed seed;
the next run will resume from that baseline.

Public source data: https://rs2b2t.com/progress. This project is unofficial and
is not affiliated with rs2b2t or the authors of 2004Tracker.

## V2 historical leaderboards

V2 is independent of the original Skill Lab. Each leaderboard has a 30-day chart of daily top-ten players, using completed UTC dates. Lines break when players leave the top ten. Legends toggle players, and chart points support hover and keyboard focus. The date slider lists each day’s values and ranks.

Historical hours use current configured EHP rates across recorded daily XP. Point history ranks each contender’s best known hour before each day ends, including pre-month records. Missing daily XP is never filled from future values. Missing hourly source history is reported, not fabricated. Partial backfill results can change as more records are recovered.

Use the Publish skill lab V2 workflow with Backfill enabled to resume a 12-minute, throttled batch. Raw XP, dated hour records and checkpoints are compressed in archive.json.gz on the history branch; the main branch remains source-only. Publishing a source change restores this archive and recalculates the static data/history.json without scraping. Cache eviction does not erase history. V2 schedules are staggered to minute 47 every six hours, with one V2 job at a time.

The initial seed reuses 38,704 checked player-days and 970 contender pairs. Backfill began with 500 additional public requests; roughly 25,000 unprocessed daily/history requests remained at publication. Counts increase as new dates and players are added. Hourly history that the source no longer retains cannot be reconstructed exactly.
