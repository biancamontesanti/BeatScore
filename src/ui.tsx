import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { ReactEcsRenderer } from '@dcl/sdk/react-ecs'
import { InputAction } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'
import {
  cancelMultiplayerReady,
  gameState,
  getSpaceWindow,
  getRoundModeLabel,
  JUDGMENT_CENTER,
  openPlayMenu,
  readyForMultiplayer,
  returnToLobby,
  startSoloMode,
  toggleMultiplayerReady,
  watchLiveMode,
} from './game'
import { Direction, TOTAL_MEASURES } from './beatmap'

// ──────────────────────────────────────────────────────────
// Per-direction style maps
// ──────────────────────────────────────────────────────────
const DIR_COLOR: Record<Direction, Color4> = {
  left:  Color4.create(0.30, 0.52, 1.00, 1),
  down:  Color4.create(0.72, 0.28, 1.00, 1),
  up:    Color4.create(0.30, 1.00, 0.52, 1),
  right: Color4.create(1.00, 0.45, 0.05, 1),
  upLeft: Color4.create(0.86, 0.95, 1.00, 1),
  upRight: Color4.create(0.20, 1.00, 0.95, 1),
}

const DIR_SYMBOL: Record<Direction, string> = {
  left:  '◄',
  down:  '▼',
  up:    '▲',
  right: '►',
  upLeft: '↖',
  upRight: '↗',
}

const DIR_KEY: Record<Direction, string> = {
  left: 'A', down: 'S', up: 'W', right: 'D', upLeft: 'Q/1', upRight: 'E',
}

type PercentUnit = `${number}%`

function getDanceModeDisplayLabel(): string {
  if (gameState.measureCount >= TOTAL_MEASURES - 1) return 'FINAL MOVE'
  return getRoundModeLabel(gameState.roundMode)
}

function CloseButton({ onClick }: { onClick: () => void }): ReactEcs.JSX.Element {
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 12, right: 12 },
        width: 42,
        height: 42,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      uiBackground={{ color: Color4.create(0.04, 0.03, 0.08, 0.92) }}
      onMouseDown={onClick}
    >
      <Label
        value="X"
        fontSize={24}
        color={Color4.create(1.0, 0.62, 0.92, 1)}
        uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
        textAlign="middle-center"
      />
    </UiEntity>
  )
}

function BackButton({ onClick }: { onClick: () => void }): ReactEcs.JSX.Element {
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 12, left: 12 },
        width: 96,
        height: 42,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      uiBackground={{ color: Color4.create(0.06, 0.06, 0.14, 0.92) }}
      onMouseDown={onClick}
    >
      <Label
        value="BACK"
        fontSize={18}
        color={Color4.create(0.70, 0.92, 1.0, 1)}
        uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
        textAlign="middle-center"
      />
    </UiEntity>
  )
}

// ──────────────────────────────────────────────────────────
// Arrow box in the Keynote bar
// state: 'done' | 'active' | 'pending' | 'failed'
// ──────────────────────────────────────────────────────────
function ArrowBox({
  displayDirection,
  inputDirection,
  inverted,
  state,
}: {
  displayDirection: Direction
  inputDirection: Direction
  inverted: boolean
  state: 'done' | 'active' | 'pending' | 'failed'
}): ReactEcs.JSX.Element {
  const c = inverted ? Color4.create(1.00, 0.12, 0.12, 1) : DIR_COLOR[displayDirection]
  const sym = state === 'done' && inverted ? DIR_SYMBOL[inputDirection] : DIR_SYMBOL[displayDirection]

  let bg: Color4
  let fg: Color4

  switch (state) {
    case 'done':
      bg = Color4.create(0.80, 0.68, 0.08, 1.00)    // gold
      fg = Color4.White()
      break
    case 'active':
      bg = Color4.create(c.r * 0.45, c.g * 0.45, c.b * 0.45, 1)
      fg = Color4.create(c.r,        c.g,         c.b,        1)
      break
    case 'pending':
      bg = Color4.create(c.r * 0.12, c.g * 0.12, c.b * 0.12, 1)
      fg = Color4.create(c.r * 0.55, c.g * 0.55, c.b * 0.55, inverted ? 1 : 0.8)
      break
    case 'failed':
      bg = Color4.create(0.25, 0.06, 0.06, 1)
      fg = Color4.create(0.55, 0.18, 0.18, 0.6)
      break
  }

  return (
    <UiEntity
      uiTransform={{
        width: 58,
        height: 58,
        margin: { left: 3, right: 3 },
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 1,
      }}
      uiBackground={{ color: bg }}
    >
      <Label
        value={sym}
        fontSize={29}
        color={fg}
        uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
        textAlign="middle-center"
      />
    </UiEntity>
  )
}

// ──────────────────────────────────────────────────────────
// Keynote bar — the row of arrows to type
// ──────────────────────────────────────────────────────────
function KeynoteBar(): ReactEcs.JSX.Element {
  const seq   = gameState.currentSequence
  const idx   = gameState.inputIndex
  const failed = gameState.sequenceFailed
  const height = gameState.roundState === 'waiting' ? 58 : 76
  const firstReverseMeasure = Math.ceil(TOTAL_MEASURES * 0.5)
  const isReverseIntro = gameState.roundMode === 'freestyle' && gameState.measureCount === firstReverseMeasure
  const isFinalMove = gameState.measureCount >= TOTAL_MEASURES - 1
  const waitingLabel = isFinalMove
    ? `FINAL MOVE  ${Math.ceil(gameState.waitTimer)}`
    : isReverseIntro
      ? `INVERT RED DIRECTIONS  ${Math.ceil(gameState.waitTimer)}`
      : `NEXT COMBO  ${Math.ceil(gameState.waitTimer)}`

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 126, left: 0 },
        width: '100%',
        height,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      {gameState.roundState === 'waiting' ? (
        <Label
          value={waitingLabel}
          fontSize={30}
          color={isReverseIntro ? Color4.create(1.0, 0.18, 0.18, 0.98) : Color4.create(1.0, 0.88, 0.2, 0.95)}
          uiTransform={{ width: '100%', height: 52, alignItems: 'center', justifyContent: 'center' }}
          textAlign="middle-center"
        />
      ) : seq.map((step, i) => {
        let state: 'done' | 'active' | 'pending' | 'failed'
        if (i < idx)         state = 'done'
        else if (failed)     state = 'failed'
        else if (i === idx)  state = 'active'
        else                 state = 'pending'
        return <ArrowBox displayDirection={step.displayDirection} inputDirection={step.inputDirection} inverted={step.inverted} state={state} />
      })}
    </UiEntity>
  )
}

// ──────────────────────────────────────────────────────────
// Rhythm timeline — moving ball + judgment zone
// ──────────────────────────────────────────────────────────
function RhythmTimeline(): ReactEcs.JSX.Element {
  const p = gameState.measureProgress
  const spaceWindow = getSpaceWindow()

  // How close is the ball to the judgment center? (0 = far, 1 = perfect)
  const distFromCenter  = Math.abs(p - JUDGMENT_CENTER)
  const jPulse          = Math.max(0, 1 - distFromCenter / 0.18)  // 1 at center, 0 outside ±0.18

  // Ball colour: cool blue when far, warm gold when in zone
  const inZone = p >= spaceWindow.start && p <= spaceWindow.end
  const ballColor = inZone
    ? Color4.create(1.0, 0.7 + jPulse * 0.3, 0.1 + jPulse * 0.1, 1)
    : Color4.create(0.4, 0.7, 1.0, 1)

  // Judgment zone background glow
  const jZoneColor = Color4.create(1.0, 0.75, 0.15, 0.12 + jPulse * 0.55)
  const visualZoneWidth = Math.max(spaceWindow.end - spaceWindow.start, 0.14)
  const visualZoneStart = Math.max(0, Math.min(1 - visualZoneWidth, JUDGMENT_CENTER - visualZoneWidth / 2))
  const jZoneLeft = `${(visualZoneStart * 100).toFixed(2)}%` as PercentUnit
  const jZoneWidth = `${(visualZoneWidth * 100).toFixed(2)}%` as PercentUnit

  const ballLeftPct = `${(p * 100).toFixed(2)}%` as PercentUnit

  // Space key: "hit" if space already pressed this measure
  const spaceFlash = gameState.spaceFlash
  const spaceColor = Color4.create(1, 0.9 + spaceFlash * 0.1, 0.2 + spaceFlash * 0.3, 0.6 + spaceFlash * 0.4)
  const hitLabel = isMobile() ? 'JUMP=HIT' : 'SPACE=HIT'

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 204, left: '10%' },
        width: '80%',
        height: 72,
        flexDirection: 'column',
      }}
    >
      {/* Row: labels above the track */}
      <UiEntity
        uiTransform={{
          width: '100%',
          height: 18,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          margin: { bottom: 4 },
        }}
      >
        <Label
          value="TYPE SEQUENCE →"
          fontSize={11}
          color={Color4.create(0.5, 0.5, 0.5, 0.9)}
          uiTransform={{ width: 160, height: 18 }}
          textAlign="middle-left"
        />
        <Label
          value={`← ${hitLabel}`}
          fontSize={11}
          color={spaceColor}
          uiTransform={{ width: 140, height: 18 }}
          textAlign="middle-right"
        />
      </UiEntity>

      {/* Track */}
      <UiEntity
        uiTransform={{ width: '100%', height: 34, positionType: 'relative' }}
        uiBackground={{ color: Color4.create(0.04, 0.04, 0.10, 0.92) }}
      >
        {/* Judgment zone glow */}
        <UiEntity
          uiTransform={{
            positionType: 'absolute',
            position: { top: 0, left: jZoneLeft },
            width: jZoneWidth,
            height: '100%',
          }}
          uiBackground={{ color: jZoneColor }}
        />

        {/* Judgment center marker (thin bright line) */}
        <UiEntity
          uiTransform={{
            positionType: 'absolute',
            position: { top: 0, left: `${(JUDGMENT_CENTER * 100 - 0.2).toFixed(1)}%` as PercentUnit },
            width: 3,
            height: '100%',
          }}
          uiBackground={{
            color: Color4.create(1, 0.9, 0.3, 0.35 + jPulse * 0.65),
          }}
        />

        {/* Moving ball */}
        <UiEntity
          uiTransform={{
            positionType: 'absolute',
            position: { top: 4, left: ballLeftPct },
            width: 26,
            height: 26,
          }}
          uiBackground={{ color: ballColor }}
        />
      </UiEntity>
    </UiEntity>
  )
}

// ──────────────────────────────────────────────────────────
// Judgment text (fades out)
// ──────────────────────────────────────────────────────────
function JudgmentDisplay(): ReactEcs.JSX.Element | null {
  if (!gameState.judgment) return null
  if (gameState.playMode === 'multiplayer') return null

  const { text, timer, totalDuration } = gameState.judgment
  const fade = Math.min(1, timer / totalDuration)

  const textColor =
    text === 'PERFECT!' ? Color4.create(0.25, 0.85, 1.0, fade) :
    text === 'GREAT!'   ? Color4.create(0.4, 1.0, 0.55, fade) :
    text === 'COOL!'    ? Color4.create(0.75, 0.35, 1.0, fade) :
    text === 'BAD!'     ? Color4.create(1.0, 0.55, 0.15, fade) :
                          Color4.create(1.0, 0.30, 0.30, fade)

  const fontSize =
    text === 'PERFECT!' ? 52 :
    text === 'GREAT!'   ? 48 : 44

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: '50%', left: '20%' },
        width: '60%',
        height: 70,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Label
        value={text}
        fontSize={fontSize}
        color={textColor}
        uiTransform={{ width: '100%', height: 70, alignItems: 'center', justifyContent: 'center' }}
        textAlign="middle-center"
      />
    </UiEntity>
  )
}

// ──────────────────────────────────────────────────────────
// Score panel (top right)
// ──────────────────────────────────────────────────────────
function ScorePanel(): ReactEcs.JSX.Element {
  const mobile = isMobile()

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: mobile ? { top: 72, right: 12 } : { top: 76, right: 24 },
        width: mobile ? 170 : 205,
        height: mobile ? 86 : 96,
        flexDirection: 'column',
        alignItems: 'flex-end',
        padding: { top: mobile ? 9 : 10, right: mobile ? 12 : 14, bottom: 10, left: 10 },
      }}
      uiBackground={{ color: Color4.create(0, 0, 0, 0.55) }}
    >
      <Label
        value="POINTS"
        fontSize={mobile ? 14 : 16}
        color={Color4.create(0.35, 0.9, 1.0, 1)}
        uiTransform={{ width: '100%', height: mobile ? 20 : 22 }}
        textAlign="middle-right"
      />
      <Label
        value={String(gameState.score)}
        fontSize={mobile ? 25 : 31}
        color={Color4.create(1.0, 0.88, 0.18, 1)}
        uiTransform={{ width: '100%', height: mobile ? 34 : 40 }}
        textAlign="middle-right"
      />
      <Label
        value={`MAX PERFECT COMBO  ${gameState.maxCombo}`}
        fontSize={mobile ? 9 : 12}
        color={Color4.create(0.82, 0.82, 0.90, 1)}
        uiTransform={{ width: '100%', height: mobile ? 18 : 20 }}
        textAlign="middle-right"
      />
    </UiEntity>
  )
}

// ──────────────────────────────────────────────────────────
// Combo display (top left)
// ──────────────────────────────────────────────────────────
function ComboDisplay(): ReactEcs.JSX.Element | null {
  if (gameState.combo < 2) return null
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 16, left: 24 },
        width: 130,
        height: 88,
        flexDirection: 'column',
        alignItems: 'flex-start',
        padding: { top: 10, left: 14 },
      }}
      uiBackground={{ color: Color4.create(0, 0, 0, 0.55) }}
    >
      <Label
        value="COMBO"
        fontSize={12}
        color={Color4.create(0.55, 0.55, 0.55, 1)}
        uiTransform={{ width: '100%', height: 18 }}
        textAlign="middle-left"
      />
      <Label
        value={String(gameState.combo)}
        fontSize={44}
        color={Color4.create(1.0, 0.70, 0.12, 1)}
        uiTransform={{ width: '100%', height: 50 }}
        textAlign="middle-left"
      />
    </UiEntity>
  )
}

// ──────────────────────────────────────────────────────────
// Current difficulty / mode badge
// ──────────────────────────────────────────────────────────
function ModeBadge(): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const mode = gameState.roundMode
  const label = getDanceModeDisplayLabel()
  const color =
    mode === 'easy'      ? Color4.create(0.4, 1.0, 0.55, 1) :
    mode === 'middle'    ? Color4.create(0.35, 0.7, 1.0, 1) :
    mode === 'freestyle' ? Color4.create(1.0, 0.2, 0.2, 1) :
                           Color4.create(1.0, 0.55, 0.15, 1)

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: mobile ? { top: 16, left: '31%' } : { top: 16, left: '34%' },
        width: mobile ? '38%' : '32%',
        height: mobile ? 58 : 62,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: { top: 6, right: 10, bottom: 6, left: 10 },
      }}
      uiBackground={{ color: Color4.create(0, 0, 0, 0.55) }}
    >
      <Label
        value={label}
        fontSize={mobile ? 23 : 27}
        color={color}
        uiTransform={{ width: '48%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
        textAlign="middle-left"
      />
      <Label
        value={`${gameState.combo}x PERFECT COMBO`}
        fontSize={mobile ? 18 : 22}
        color={Color4.create(1, 0.76, 0.16, 1)}
        uiTransform={{ width: '50%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
        textAlign="middle-right"
      />
    </UiEntity>
  )
}

// ──────────────────────────────────────────────────────────
// Measure progress bar (thin strip at top)
// ──────────────────────────────────────────────────────────
function MeasureBar(): ReactEcs.JSX.Element {
  const pct = `${((gameState.measureCount / TOTAL_MEASURES) * 100).toFixed(1)}%` as PercentUnit
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        width: '100%',
        height: 6,
      }}
      uiBackground={{ color: Color4.create(0.06, 0.06, 0.12, 1) }}
    >
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: pct, height: '100%' }}
        uiBackground={{ color: Color4.create(0.35, 0.6, 1.0, 0.85) }}
      />
    </UiEntity>
  )
}

function placementLabel(index: number): string {
  if (index === 0) return '1ST'
  if (index === 1) return '2ND'
  if (index === 2) return '3RD'
  return `${index + 1}TH`
}

function getActiveMatchEntries() {
  const matchEntries = gameState.matchPlayers.filter(player =>
    player.ready && (player.phase === 'playing' || player.phase === 'gameover')
  )

  if (matchEntries.length > 0) return matchEntries.slice().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.maxCombo !== a.maxCombo) return b.maxCombo - a.maxCombo
    return a.name.localeCompare(b.name)
  })

  return [{
      playerId: 'local-player',
      name: 'YOU',
      score: gameState.score,
      maxCombo: gameState.maxCombo,
      rankPoints: gameState.rankPoints,
      wins: 0,
      matchesPlayed: 0,
      slotIndex: 0,
      finished: false,
      ready: true,
      phase: gameState.phase,
      matchStartTime: 0,
      isLocal: true,
      lastSeen: Date.now(),
    }]
}

function MatchPositionPanel(): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const entries = getActiveMatchEntries()
  const localIndex = Math.max(0, entries.findIndex(entry => entry.isLocal))
  const localEntry = entries[localIndex] || entries[0]
  const score = localEntry?.score ?? gameState.score
  const name = localEntry?.isLocal ? 'YOU' : String(localEntry?.name || 'YOU').slice(0, 10)
  const place = placementLabel(localIndex)

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: mobile ? { top: 16, right: 12 } : { top: 16, right: 24 },
        width: mobile ? 156 : 188,
        height: mobile ? 96 : 106,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: { top: mobile ? 10 : 12, right: mobile ? 10 : 12, bottom: mobile ? 10 : 12, left: mobile ? 10 : 12 },
      }}
      uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.78) }}
    >
      <Label
        value={place}
        fontSize={mobile ? 36 : 42}
        color={localIndex === 0 ? Color4.create(1, 0.82, 0.18, 1) : Color4.create(0.50, 0.90, 1.0, 1)}
        uiTransform={{ width: '100%', height: mobile ? 38 : 44 }}
        textAlign="middle-center"
      />
      <Label
        value={name}
        fontSize={mobile ? 15 : 18}
        color={Color4.create(0.92, 0.92, 1, 1)}
        uiTransform={{ width: '100%', height: mobile ? 22 : 26 }}
        textAlign="middle-center"
      />
      <Label
        value={String(score)}
        fontSize={mobile ? 18 : 22}
        color={Color4.create(1.0, 0.88, 0.18, 1)}
        uiTransform={{ width: '100%', height: mobile ? 26 : 30 }}
        textAlign="middle-center"
      />
    </UiEntity>
  )
}

function ReadyPlayersPanel(): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const readyPlayers = gameState.matchPlayers
    .filter(player => player.ready && player.phase === 'ready')
    .sort((a, b) => {
      if (b.rankPoints !== a.rankPoints) return b.rankPoints - a.rankPoints
      return a.name.localeCompare(b.name)
    })
    .slice(0, 20)

  const columns = mobile ? 3 : 5
  const visibleRows = mobile ? 1 : 2
  const capacity = columns * visibleRows
  const pageCount = Math.max(1, Math.ceil(readyPlayers.length / capacity))
  const page = readyPlayers.length > capacity ? Math.floor(Date.now() / 3500) % pageCount : 0
  const pagePlayers = readyPlayers.slice(page * capacity, page * capacity + capacity)
  const rows = Array.from({ length: visibleRows }, (_, row) => pagePlayers.slice(row * columns, row * columns + columns))
  const panelTitle = pageCount > 1
    ? `READY PLAYERS  ${readyPlayers.length}/20  ${page + 1}/${pageCount}`
    : `READY PLAYERS  ${readyPlayers.length}/20`

  return (
    <UiEntity
      uiTransform={{
        width: mobile ? '100%' : '92%',
        height: mobile ? 128 : 214,
        flexDirection: 'column',
        padding: mobile
          ? { top: 8, right: 8, bottom: 8, left: 8 }
          : { top: 12, right: 12, bottom: 12, left: 12 },
      }}
    >
      <Label
        value={panelTitle}
        fontSize={mobile ? 18 : 20}
        color={Color4.create(0.40, 1.0, 0.85, 1)}
        uiTransform={{ width: '100%', height: mobile ? 24 : 30, margin: { bottom: mobile ? 6 : 8 } }}
        textAlign="middle-center"
      />

      {readyPlayers.length === 0 ? (
        <Label
          value="Waiting for dancers"
          fontSize={16}
          color={Color4.create(0.72, 0.72, 0.82, 1)}
          uiTransform={{ width: '100%', height: 52 }}
          textAlign="middle-center"
        />
      ) : null}

      {rows.map((row, rowIndex) => (
        <UiEntity
          key={`ready-row-${rowIndex}`}
          uiTransform={{ width: '100%', height: mobile ? 84 : 76, flexDirection: 'row', justifyContent: 'center', margin: { bottom: mobile ? 4 : 6 } }}
        >
          {row.map((player, i) => (
            <UiEntity
              key={`ready-${player.playerId}-${i}`}
              uiTransform={{
                width: mobile ? 78 : 76,
                height: mobile ? 80 : 72,
                flexDirection: 'column',
                alignItems: 'center',
                margin: { left: mobile ? 2 : 3, right: mobile ? 2 : 3 },
              }}
              uiBackground={{ color: player.isLocal ? Color4.create(0.07, 0.28, 0.32, 0.68) : Color4.create(0.05, 0.05, 0.12, 0.62) }}
            >
              <UiEntity
                uiTransform={{ width: mobile ? 44 : 36, height: mobile ? 44 : 36, margin: { top: 5, bottom: 3 } }}
                uiBackground={{ avatarTexture: { userId: player.playerId }, textureMode: 'stretch' }}
              />
              <Label
                value={player.isLocal ? 'YOU' : String(player.name).slice(0, 8)}
                fontSize={mobile ? 12 : 10}
                color={Color4.create(0.92, 0.92, 1, 1)}
                uiTransform={{ width: '100%', height: 18 }}
                textAlign="middle-center"
              />
              <Label
                value={`${player.rankPoints} RP`}
                fontSize={mobile ? 12 : 10}
                color={Color4.create(1.0, 0.82, 0.22, 1)}
                uiTransform={{ width: '100%', height: 18 }}
                textAlign="middle-center"
              />
            </UiEntity>
          ))}
        </UiEntity>
      ))}
    </UiEntity>
  )
}

function RankAvatarBadge(): ReactEcs.JSX.Element {
  const panelLeft = isMobile() ? 18 : 64

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 132, left: panelLeft },
        width: 210,
        height: 66,
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: { top: 6, right: 10, bottom: 6, left: 10 },
      }}
      uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.66) }}
    >
      <Label
        value={gameState.danceRank}
        fontSize={20}
        color={Color4.create(0.86, 0.86, 0.92, 1)}
        uiTransform={{ width: '100%', height: 28 }}
        textAlign="middle-left"
      />
      <Label
        value={`RP ${gameState.rankPoints}`}
        fontSize={22}
        color={Color4.create(1, 0.82, 0.22, 1)}
        uiTransform={{ width: '100%', height: 30 }}
        textAlign="middle-left"
      />
    </UiEntity>
  )
}

function DailyGoalsPanel(): ReactEcs.JSX.Element {
  const rankPct = `${(gameState.rankProgress * 100).toFixed(1)}%` as PercentUnit
  const panelLeft = isMobile() ? 18 : 64

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 206, left: panelLeft },
        width: 210,
        height: 134,
        flexDirection: 'column',
        padding: { top: 8, right: 10, bottom: 8, left: 10 },
      }}
      uiBackground={{ color: Color4.create(0.02, 0.02, 0.07, 0.62) }}
    >
      <Label
        value="DAILY GOALS"
        fontSize={12}
        color={Color4.create(0.72, 0.88, 1, 1)}
        uiTransform={{ width: '100%', height: 18, margin: { bottom: 4 } }}
        textAlign="middle-left"
      />
      <UiEntity uiTransform={{ width: '100%', height: 10, margin: { bottom: 7 } }} uiBackground={{ color: Color4.create(0.08, 0.08, 0.16, 0.95) }}>
        <UiEntity uiTransform={{ width: rankPct, height: '100%' }} uiBackground={{ color: Color4.create(0.9, 0.25, 1, 0.9) }} />
      </UiEntity>

      {gameState.dailyGoals.map(goal => {
        const progress = `${goal.progress}/${goal.target}`
        return (
          <UiEntity
            key={goal.id}
            uiTransform={{ width: '100%', height: 25, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Label
              value={goal.completed ? `${goal.label} DONE` : goal.label}
              fontSize={11}
              color={goal.completed ? Color4.create(0.42, 1, 0.58, 1) : Color4.create(0.82, 0.82, 0.9, 1)}
              uiTransform={{ width: 135, height: 24 }}
              textAlign="middle-left"
            />
            <Label
              value={goal.completed ? `+${goal.rewardRp} RP` : progress}
              fontSize={11}
              color={Color4.create(1, 0.82, 0.22, 1)}
              uiTransform={{ width: 55, height: 24 }}
              textAlign="middle-right"
            />
          </UiEntity>
        )
      })}
    </UiEntity>
  )
}

function DailyGoalsMenuCard({ compact = false }: { compact?: boolean }): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const rankPct = `${(gameState.rankProgress * 100).toFixed(1)}%` as PercentUnit
  const rowHeight = compact ? 20 : mobile ? 24 : 24

  return (
    <UiEntity
      uiTransform={{
        width: compact ? '100%' : mobile ? '86%' : 320,
        height: compact ? 102 : mobile ? 112 : 126,
        flexDirection: 'column',
        padding: compact
          ? { top: 6, right: 6, bottom: 6, left: 6 }
          : { top: mobile ? 5 : 8, right: 10, bottom: mobile ? 5 : 8, left: 10 },
        margin: { bottom: compact ? 8 : mobile ? 8 : 12 },
      }}
      uiBackground={{ color: Color4.create(0.02, 0.02, 0.07, compact ? 0.70 : 0.62) }}
    >
      <Label
        value={compact ? 'GOALS' : 'DAILY GOALS'}
        fontSize={compact ? 12 : mobile ? 16 : 15}
        color={Color4.create(0.72, 0.88, 1, 1)}
        uiTransform={{ width: '100%', height: compact ? 16 : mobile ? 21 : 20 }}
        textAlign="middle-left"
      />
      <UiEntity uiTransform={{ width: '100%', height: compact ? 6 : mobile ? 6 : 8, margin: { bottom: compact ? 4 : mobile ? 3 : 6 } }} uiBackground={{ color: Color4.create(0.08, 0.08, 0.16, 0.95) }}>
        <UiEntity uiTransform={{ width: rankPct, height: '100%' }} uiBackground={{ color: Color4.create(0.9, 0.25, 1, 0.9) }} />
      </UiEntity>

      {gameState.dailyGoals.map(goal => (
        <UiEntity
          key={`menu-${goal.id}`}
          uiTransform={{ width: '100%', height: rowHeight, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <Label
            value={goal.completed ? `${goal.label} DONE` : goal.label}
            fontSize={compact ? 9 : mobile ? 13 : 12}
            color={goal.completed ? Color4.create(0.42, 1, 0.58, 1) : Color4.create(0.82, 0.82, 0.9, 1)}
            uiTransform={{ width: compact ? '64%' : mobile ? '66%' : '70%', height: '100%' }}
            textAlign="middle-left"
          />
          <Label
            value={goal.completed ? `+${goal.rewardRp}` : `${goal.progress}/${goal.target}`}
            fontSize={compact ? 9 : mobile ? 13 : 12}
            color={Color4.create(1, 0.82, 0.22, 1)}
            uiTransform={{ width: compact ? '34%' : mobile ? '32%' : '28%', height: '100%' }}
            textAlign="middle-right"
          />
        </UiEntity>
      ))}
    </UiEntity>
  )
}

function OfficialTouchButton({
  action,
  label,
  x,
  y,
  size,
  tone,
}: {
  action: InputAction
  label: string
  x: number
  y: number
  size: number
  tone: Color4
}): ReactEcs.JSX.Element {
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { left: x, top: y },
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      uiBackground={{ color: Color4.create(0, 0, 0, 0.58) }}
      uiInputBinding={{ actions: [action] }}
    >
      <UiEntity
        uiTransform={{
          width: size - 12,
          height: size - 12,
          alignItems: 'center',
          justifyContent: 'center',
        }}
        uiBackground={{ color: Color4.create(tone.r * 0.18, tone.g * 0.18, tone.b * 0.18, 0.78) }}
      >
        <Label
          value={label}
          fontSize={size > 78 ? 30 : 24}
          color={Color4.White()}
          uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
          textAlign="middle-center"
        />
      </UiEntity>
    </UiEntity>
  )
}

function OfficialMobileControls(): ReactEcs.JSX.Element | null {
  if (!isMobile()) return null

  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { bottom: 8, left: 0 }, width: '100%', height: 312 }}>
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { bottom: 0, left: 16 },
          width: 318,
          height: 304,
        }}
      >
        <OfficialTouchButton action={InputAction.IA_ACTION_5} label={DIR_SYMBOL.up} x={108} y={0} size={101} tone={DIR_COLOR.up} />
        <OfficialTouchButton action={InputAction.IA_ACTION_3} label={DIR_SYMBOL.left} x={0} y={101} size={101} tone={DIR_COLOR.left} />
        <OfficialTouchButton action={InputAction.IA_ACTION_4} label={DIR_SYMBOL.right} x={216} y={101} size={101} tone={DIR_COLOR.right} />
        <OfficialTouchButton action={InputAction.IA_ACTION_6} label={DIR_SYMBOL.down} x={108} y={202} size={101} tone={DIR_COLOR.down} />
        <UiEntity
          uiTransform={{
            positionType: 'absolute',
            position: { left: 108, top: 101 },
            width: 101,
            height: 101,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          uiBackground={{ color: Color4.create(0, 0, 0, 0.38) }}
        >
          <UiEntity
            uiTransform={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
            uiBackground={{ color: Color4.create(0.90, 0.90, 0.96, 0.24) }}
          />
        </UiEntity>
      </UiEntity>

      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { bottom: 0, right: 16 },
          width: 206,
          height: 206,
        }}
      >
        <UiEntity
          uiTransform={{
            positionType: 'absolute',
            position: { right: 0, bottom: 0 },
            width: 206,
            height: 206,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          uiBackground={{ color: Color4.create(0, 0, 0, 0.62) }}
          uiInputBinding={{ actions: [InputAction.IA_JUMP] }}
        >
          <UiEntity
            uiTransform={{ width: 170, height: 170, alignItems: 'center', justifyContent: 'center' }}
            uiBackground={{ color: Color4.create(DIR_COLOR.right.r * 0.42, DIR_COLOR.right.g * 0.42, DIR_COLOR.right.b * 0.42, 0.90) }}
          >
            <Label
              value="HIT"
              fontSize={50}
              color={Color4.White()}
              uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
              textAlign="middle-center"
            />
          </UiEntity>
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

// ──────────────────────────────────────────────────────────
// Key-hint row (shown near the top when idle, or as reminder)
// ──────────────────────────────────────────────────────────
function KeyHints(): ReactEcs.JSX.Element {
  const dirs: Direction[] = ['left', 'down', 'up', 'right']
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: '28%', left: 0 },
        width: '100%',
        height: 32,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      {dirs.map(d => (
        <UiEntity
          key={d}
          uiTransform={{
            width: 70,
            height: 28,
            margin: { left: 4, right: 4 },
            alignItems: 'center',
            justifyContent: 'center',
          }}
          uiBackground={{ color: Color4.create(0.08, 0.08, 0.18, 0.7) }}
        >
          <Label
            value={`${DIR_KEY[d]}=${DIR_SYMBOL[d]}`}
            fontSize={13}
            color={DIR_COLOR[d]}
            uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
            textAlign="middle-center"
          />
        </UiEntity>
      ))}
      {gameState.roundMode === 'freestyle' ? (
        <UiEntity
          uiTransform={{
            width: 130,
            height: 28,
            margin: { left: 12, right: 4 },
            alignItems: 'center',
            justifyContent: 'center',
          }}
          uiBackground={{ color: Color4.create(0.26, 0.02, 0.02, 0.82) }}
        >
          <Label
            value="RED=REVERSE"
            fontSize={12}
            color={Color4.create(1.0, 0.18, 0.18, 1)}
            uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
            textAlign="middle-center"
          />
        </UiEntity>
      ) : null}
      <UiEntity
        uiTransform={{
          width: 100,
          height: 28,
          margin: { left: 12, right: 4 },
          alignItems: 'center',
          justifyContent: 'center',
        }}
        uiBackground={{ color: Color4.create(0.15, 0.12, 0.03, 0.7) }}
      >
        <Label
          value="SPACE=HIT"
          fontSize={13}
          color={Color4.create(1.0, 0.88, 0.2, 0.9)}
          uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
          textAlign="middle-center"
        />
      </UiEntity>
    </UiEntity>
  )
}

// ──────────────────────────────────────────────────────────
// Idle / title screen
// ──────────────────────────────────────────────────────────
function LobbyChoiceScreen(): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const panelWidth = mobile ? '62%' : '44%'
  const panelLeft = mobile ? '19%' : '28%'
  const panelHeight = mobile ? 318 : 430
  const buttonWidth = mobile ? '86%' : 320

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: mobile ? '16%' : '22%', left: panelLeft },
        width: panelWidth,
        height: panelHeight,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: { top: mobile ? 10 : 22, bottom: mobile ? 10 : 22, left: mobile ? 14 : 24, right: mobile ? 14 : 24 },
      }}
      uiBackground={{ color: Color4.create(0, 0, 0, 0.82) }}
    >
      <CloseButton onClick={watchLiveMode} />
      <Label value="DROP BEAT" fontSize={mobile ? 38 : 42}
        color={Color4.create(1.0, 0.38, 0.88, 1)}
        uiTransform={{ width: '100%', height: mobile ? 44 : 54, margin: { bottom: mobile ? 2 : 8 } }} textAlign="middle-center" />

      <Label value={`${gameState.danceRank}  •  ${gameState.rankPoints} RP`} fontSize={mobile ? 16 : 18}
        color={Color4.create(0.35, 0.9, 1.0, 1)}
        uiTransform={{ width: '100%', height: mobile ? 22 : 28, margin: { bottom: mobile ? 5 : 10 } }} textAlign="middle-center" />

      <DailyGoalsMenuCard />

      <UiEntity
        uiTransform={{ width: buttonWidth, height: mobile ? 42 : 58, alignItems: 'center', justifyContent: 'center', margin: { bottom: mobile ? 8 : 12 } }}
        uiBackground={{ color: Color4.create(0.06, 0.18, 0.26, 0.92) }}
        onMouseDown={openPlayMenu}
      >
        <Label value="DANCE" fontSize={mobile ? 18 : 22}
          color={Color4.create(0.50, 0.90, 1.0, 1)}
          uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }} textAlign="middle-center" />
      </UiEntity>
      <UiEntity
        uiTransform={{ width: buttonWidth, height: mobile ? 42 : 58, alignItems: 'center', justifyContent: 'center' }}
        uiBackground={{ color: Color4.create(0.18, 0.10, 0.30, 0.92) }}
        onMouseDown={watchLiveMode}
      >
        <Label value="JUST WATCH" fontSize={mobile ? 18 : 22}
          color={Color4.create(0.90, 0.55, 1.0, 1)}
          uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }} textAlign="middle-center" />
      </UiEntity>
    </UiEntity>
  )
}

function IdleScreen(): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const panelWidth = mobile ? '60%' : '46%'
  const panelLeft = mobile ? '20%' : '27%'
  const panelHeight = mobile ? 298 : 350
  const buttonWidth = mobile ? '86%' : 360

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: mobile ? '14%' : '18%', left: panelLeft },
        width: panelWidth,
        height: panelHeight,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: { top: mobile ? 14 : 22, bottom: mobile ? 14 : 22, left: mobile ? 14 : 24, right: mobile ? 14 : 24 },
      }}
      uiBackground={{ color: Color4.create(0, 0, 0, 0.80) }}
    >
      <BackButton onClick={returnToLobby} />
      <CloseButton onClick={watchLiveMode} />
      <Label value="DROP BEAT" fontSize={mobile ? 38 : 44}
        color={Color4.create(1.0, 0.38, 0.88, 1)}
        uiTransform={{ width: '100%', height: mobile ? 46 : 58 }} textAlign="middle-center" />
      <Label value={`${gameState.danceRank}  •  ${gameState.rankPoints} RP`} fontSize={mobile ? 18 : 18}
        color={Color4.create(0.35, 0.9, 1.0, 1)}
        uiTransform={{ width: '100%', height: mobile ? 30 : 30, margin: { bottom: mobile ? 10 : 14 } }} textAlign="middle-center" />
      <Label value="CHOOSE MODE" fontSize={mobile ? 18 : 21}
        color={Color4.create(0.40, 1.0, 0.85, 1)}
        uiTransform={{ width: '100%', height: mobile ? 28 : 34 }} textAlign="middle-center" />
      <Label value=" " fontSize={4} color={Color4.create(0,0,0,0)}
        uiTransform={{ width: '100%', height: mobile ? 8 : 12 }} textAlign="middle-center" />
      <UiEntity
        uiTransform={{ width: buttonWidth, height: mobile ? 50 : 58, alignItems: 'center', justifyContent: 'center', margin: { bottom: mobile ? 9 : 12 } }}
        uiBackground={{ color: Color4.create(0.18, 0.19, 0.23, 0.94) }}
        onMouseDown={readyForMultiplayer}
      >
        <Label value="MULTIPLAYER" fontSize={mobile ? 20 : 23}
          color={Color4.create(0.40, 1.0, 0.85, 1)}
          uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }} textAlign="middle-center" />
      </UiEntity>
      <UiEntity
        uiTransform={{ width: buttonWidth, height: mobile ? 50 : 58, alignItems: 'center', justifyContent: 'center' }}
        uiBackground={{ color: Color4.create(0.18, 0.10, 0.30, 0.94) }}
        onMouseDown={startSoloMode}
      >
        <Label value="SOLO MODE" fontSize={mobile ? 20 : 23}
          color={Color4.create(0.90, 0.55, 1.0, 1)}
          uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }} textAlign="middle-center" />
      </UiEntity>
    </UiEntity>
  )
}

function ReadyScreen(): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const buttonWidth = mobile ? '66%' : 280
  const localIsReady = gameState.matchPlayers.some(player => player.isLocal && player.ready && player.phase === 'ready')

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: mobile ? { top: '10%', left: '22%' } : { top: '11%', left: '26.5%' },
        width: mobile ? '56%' : '47%',
        height: mobile ? 400 : 530,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        padding: { top: mobile ? 12 : 22, bottom: mobile ? 12 : 22, left: mobile ? 12 : 22, right: mobile ? 12 : 22 },
      }}
      uiBackground={{ color: Color4.create(0, 0, 0, 0.82) }}
    >
      <BackButton onClick={cancelMultiplayerReady} />
      <CloseButton onClick={watchLiveMode} />
      <Label value="READY FOR NEXT MATCH" fontSize={mobile ? 26 : 30}
        color={Color4.create(0.40, 1.0, 0.85, 1)}
        uiTransform={{ width: '100%', height: mobile ? 36 : 46 }} textAlign="middle-center" />
      <Label value={`${Math.ceil(gameState.multiplayerCountdown)}`} fontSize={mobile ? 64 : 84}
        color={Color4.create(1.0, 0.82, 0.20, 1)}
        uiTransform={{ width: '100%', height: mobile ? 76 : 100 }} textAlign="middle-center" />
      <Label value="Stay ready in audience until it starts" fontSize={mobile ? 16 : 17}
        color={Color4.create(0.80, 0.80, 0.90, 1)}
        uiTransform={{ width: '100%', height: 28, margin: { bottom: mobile ? 8 : 12 } }} textAlign="middle-center" />
      <ReadyPlayersPanel />
      <UiEntity
        uiTransform={{
          width: buttonWidth,
          height: mobile ? 56 : 60,
          alignItems: 'center',
          justifyContent: 'center',
          margin: { top: mobile ? 10 : 14 },
        }}
        uiBackground={{
          color: localIsReady
            ? Color4.create(0.04, 0.40, 0.18, 0.94)
            : Color4.create(0.18, 0.19, 0.23, 0.94),
        }}
        onMouseDown={toggleMultiplayerReady}
      >
        <Label
          value={localIsReady ? 'READY ✓' : 'GET READY'}
          fontSize={mobile ? 22 : 24}
          color={localIsReady ? Color4.create(0.78, 1.0, 0.78, 1) : Color4.create(0.78, 0.82, 0.88, 1)}
          uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
          textAlign="middle-center"
        />
      </UiEntity>
    </UiEntity>
  )
}

function SidePlayMenu(): ReactEcs.JSX.Element {
  const mobile = isMobile()

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: mobile ? { top: '17%', right: 10 } : { top: '26%', right: 22 },
        width: mobile ? 132 : 164,
        height: mobile ? 238 : 262,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
      }}
      uiBackground={{ color: Color4.create(0.01, 0.01, 0.05, 0.78) }}
    >
      <UiEntity
        uiTransform={{ width: '100%', height: mobile ? 38 : 44, alignItems: 'center', justifyContent: 'center', margin: { bottom: 4 } }}
        uiBackground={{ color: Color4.create(0.06, 0.20, 0.28, 0.86) }}
      >
        <Label
          value={`${gameState.danceRank}\n${gameState.rankPoints} RP`}
          fontSize={mobile ? 11 : 12}
          color={Color4.create(1.0, 0.82, 0.22, 1)}
          uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
          textAlign="middle-center"
        />
      </UiEntity>
      <UiEntity
        uiTransform={{ width: '100%', height: mobile ? 46 : 52, alignItems: 'center', justifyContent: 'center', margin: { top: 8 } }}
        uiBackground={{ color: Color4.create(0.05, 0.30, 0.40, 0.94) }}
        onMouseDown={readyForMultiplayer}
      >
        <Label
          value="MULTI"
          fontSize={mobile ? 18 : 20}
          color={Color4.create(0.40, 1.0, 0.85, 1)}
          uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
          textAlign="middle-center"
        />
      </UiEntity>
      <UiEntity
        uiTransform={{ width: '100%', height: mobile ? 46 : 52, alignItems: 'center', justifyContent: 'center', margin: { top: 8 } }}
        uiBackground={{ color: Color4.create(0.18, 0.10, 0.30, 0.94) }}
        onMouseDown={startSoloMode}
      >
        <Label
          value="SOLO"
          fontSize={mobile ? 18 : 20}
          color={Color4.create(0.90, 0.55, 1.0, 1)}
          uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
          textAlign="middle-center"
        />
      </UiEntity>
      <DailyGoalsMenuCard compact />
    </UiEntity>
  )
}

// ──────────────────────────────────────────────────────────
// Game-over / results screen
// ──────────────────────────────────────────────────────────
function GameOverScreen(): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const s = gameState.score
  const finalEntries = gameState.playMode === 'multiplayer'
    ? getActiveMatchEntries().slice(0, 5)
    : []
  const stars =
    s >= 200000 ? 5 :
    s >= 100000 ? 4 :
    s >=  50000 ? 3 :
    s >=  20000 ? 2 :
    s >       0 ? 1 : 0
  const starText = `${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}`
  const starColor = stars >= 4 ? Color4.create(1.0, 0.82, 0.14, 1) :
    stars >= 2 ? Color4.create(0.90, 0.55, 1.0, 1) :
                 Color4.create(0.58, 0.58, 0.66, 1)

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: mobile ? { top: '13%', left: '22%' } : { top: '12%', left: '18.5%' },
        width: mobile ? '56%' : '63%',
        height: mobile ? 416 : 468,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        padding: { top: mobile ? 16 : 20, bottom: mobile ? 16 : 20, left: mobile ? 16 : 22, right: mobile ? 16 : 22 },
      }}
      uiBackground={{ color: Color4.create(0, 0, 0, 0.85) }}
    >
      <Label value="RESULTS" fontSize={mobile ? 42 : 50}
        color={Color4.create(0.85, 0.85, 0.85, 1)}
        uiTransform={{ width: '100%', height: mobile ? 48 : 58 }} textAlign="middle-center" />

      <Label value={starText} fontSize={mobile ? 74 : 91}
        color={starColor}
        uiTransform={{ width: '100%', height: mobile ? 88 : 104 }} textAlign="middle-center" />

      <Label value={`SCORE  ${String(s).padStart(9, '0')}`} fontSize={mobile ? 31 : 41}
        color={Color4.create(1.0, 0.88, 0.18, 1)}
        uiTransform={{ width: '100%', height: mobile ? 38 : 48 }} textAlign="middle-center" />

      <Label value={`MAX PERFECT COMBO  ${gameState.maxCombo}`} fontSize={mobile ? 24 : 29}
        color={Color4.create(0.65, 0.65, 0.65, 1)}
        uiTransform={{ width: '100%', height: mobile ? 30 : 36 }} textAlign="middle-center" />

      <Label value={gameState.playMode === 'multiplayer' ? `WINNER  ${gameState.matchWinnerName || 'YOU'}` : 'SOLO RUN'} fontSize={mobile ? 22 : 26}
        color={Color4.create(0.35, 0.9, 1.0, 1)}
        uiTransform={{ width: '100%', height: mobile ? 28 : 32 }} textAlign="middle-center" />

      <Label value={`${gameState.danceRank}  ${gameState.rankPoints} RP`} fontSize={mobile ? 20 : 24}
        color={Color4.create(0.9, 0.35, 1.0, 1)}
        uiTransform={{ width: '100%', height: mobile ? 26 : 30 }} textAlign="middle-center" />

      {gameState.playMode === 'multiplayer' ? (
        <UiEntity
          uiTransform={{ width: mobile ? '92%' : '76%', height: mobile ? 118 : 142, flexDirection: 'column', justifyContent: 'center', margin: { top: mobile ? 2 : 6, bottom: 2 } }}
        >
          {finalEntries.map((entry, i) => (
            <UiEntity
              key={`match-result-${entry.playerId}-${i}`}
              uiTransform={{ width: '100%', height: mobile ? 22 : 30, margin: { bottom: 2 }, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: { left: 10, right: 10 } }}
              uiBackground={{ color: entry.isLocal ? Color4.create(0.08, 0.26, 0.34, 0.78) : Color4.create(0.06, 0.06, 0.12, 0.68) }}
            >
              <Label value={`${placementLabel(i)}  ${entry.isLocal ? 'YOU' : String(entry.name).slice(0, 12)}`} fontSize={16}
                color={i === 0 ? Color4.create(1, 0.82, 0.22, 1) : Color4.create(0.86, 0.86, 0.94, 1)}
                uiTransform={{ width: '46%', height: '100%' }} textAlign="middle-left" />
              <Label value={`${entry.score}  ${entry.maxCombo}x PERFECT`} fontSize={16}
                color={Color4.create(1, 0.82, 0.22, 1)}
                uiTransform={{ width: '50%', height: '100%' }} textAlign="middle-right" />
            </UiEntity>
          ))}
        </UiEntity>
      ) : null}
    </UiEntity>
  )
}

// ──────────────────────────────────────────────────────────
// Root UI component
// ──────────────────────────────────────────────────────────
function AuditionUI(): ReactEcs.JSX.Element {
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%' }}>

      {gameState.phase === 'idle' && gameState.lobbyPrompt === 'choice' ? <LobbyChoiceScreen /> : null}
      {gameState.phase === 'idle' && gameState.lobbyPrompt === 'play' ? <IdleScreen /> : null}
      {gameState.phase === 'idle' && gameState.lobbyPrompt === 'hidden' ? <SidePlayMenu /> : null}
      {gameState.phase === 'ready'    ? <ReadyScreen />    : null}
      {gameState.phase === 'gameover' ? <GameOverScreen /> : null}

      {gameState.phase === 'playing' ? (
        <UiEntity
          uiTransform={{
            positionType: 'absolute',
            position: { top: 0, left: 0 },
            width: '100%',
            height: '100%',
          }}
        >
          <MeasureBar />
          {gameState.playMode === 'multiplayer' ? <MatchPositionPanel /> : null}
          {gameState.playMode === 'solo' ? <ScorePanel /> : null}
          <ModeBadge />
          <RankAvatarBadge />
          <DailyGoalsPanel />
          <KeynoteBar />
          {gameState.roundState === 'active' ? <RhythmTimeline /> : null}
          <OfficialMobileControls />
          <JudgmentDisplay />
        </UiEntity>
      ) : null}

    </UiEntity>
  )
}

// ──────────────────────────────────────────────────────────
// Public initialiser
// ──────────────────────────────────────────────────────────
export function setupUI(): void {
  ReactEcsRenderer.setUiRenderer(AuditionUI)
}
