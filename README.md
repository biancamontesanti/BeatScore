# Beat Score

Beat Score is a Decentraland SDK7 rhythm dance game built around quick arrow combos, tight timing, and score-chasing dance battles.

Players step onto a neon club floor, follow the displayed direction sequence, and hit the beat window at the right moment to earn judgments, build combos, climb ranks, and compete with other dancers.

## Game Overview

Beat Score combines dance-game combo input with a timing-based rhythm hit. Each measure gives the player a short direction sequence. The player enters the sequence first, then presses the beat hit input when the moving rhythm marker reaches the judgment zone.

The game runs on a 128 BPM track and plays through 23 measures, ending with a final move.

## Core Mechanics

- Direction combos: Enter the displayed arrows in order before the beat hit.
- Beat hit: Press Space on desktop, or Jump on mobile, when the marker reaches the highlighted judgment zone.
- Timing judgments: Hits are graded as PERFECT, GREAT, COOL, BAD, or MISS.
- Combo scoring: Strong timing and complete sequences increase score and max combo.
- Failed sequences: Pressing a wrong direction breaks the current sequence for that measure.
- Reactive dance floor: Floor tiles pulse and flash with the beat, player movement, and match state.

## Controls

Desktop:

- `A`: left
- `S`: down
- `W`: up
- `D`: right
- `Q` or `1`: up-left
- `E`: up-right
- `Space`: beat hit

Mobile:

- Use the on-screen Decentraland movement controls for direction input.
- Use Jump as the beat hit.

## Timing Windows

The rhythm marker moves across the timeline once per measure. The best hit is near the judgment center.

- PERFECT: within about 35 ms
- GREAT: within about 75 ms
- COOL: within about 120 ms
- BAD: within about 180 ms
- MISS: no valid hit, an incomplete combo, or a badly timed input

## Round Modes

Beat Score changes the feel of the combo rounds as the song progresses:

- Easy: standard one-measure rhythm flow.
- Middle: longer combo windows and a slightly higher score multiplier.
- Freestyle: longer sequences, higher scoring, and inverted red directions.
- Hard: longer patterns with a high score multiplier.
- Final Move: the last measure challenge before the run ends.

## Progression

Players earn rank points from strong performances and completed goals. Progress is saved locally in the browser.

Dance ranks include:

- Street Rookie
- Beat Apprentice
- Club Regular
- Spotlight Ace
- Dance Royalty

Daily goals rotate based on the day and player rank. Goals can ask players to land PERFECT hits, build PERFECT combos, finish the song, reach score targets, or play multiplayer.

## Multiplayer

Beat Score includes a multiplayer dance-battle prototype using Decentraland message bus sync.

Players can:

- Queue for synchronized multiplayer matches.
- See other ready and active dancers.
- Compare live score, combo, rank points, wins, and match results.
- Watch active live matches from the audience.
- Celebrate the winner after a battle ends.

Multiplayer matches start on shared timed windows when enough players are ready.

## Project Structure

- `src/index.ts`: scene entry point.
- `src/game.ts`: rhythm logic, input, scoring, progression, multiplayer state, and camera flow.
- `src/beatmap.ts`: BPM, measure duration, and song length constants.
- `src/dancefloor.ts`: 3D club floor, reactive tiles, stage visuals, leaderboards, and winner displays.
- `src/ui.tsx`: ReactEcs HUD, menus, rhythm timeline, combo bar, score, goals, and multiplayer screens.
- `public/sounds/`: music and hit feedback sounds.
- `public/emotes/`: avatar animation assets.

## Development

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm start
```

Build:

```bash
npm run build
```

Deploy:

```bash
npm run deploy
```

## Repository

GitHub: [biancamontesanti/BeatScore](https://github.com/biancamontesanti/BeatScore)
