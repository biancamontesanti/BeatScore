import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { ReactEcsRenderer } from '@dcl/sdk/react-ecs'
import { AudioSource, engine, InputAction } from '@dcl/sdk/ecs'
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
  left: Color4.create(1.00, 0.400, 0.851, 1),
  down: Color4.create(0.482, 0.380, 1.00, 1),
  up: Color4.create(0.00, 0.831, 1.00, 1),
  right: Color4.create(0.188, 0.890, 0.420, 1),
  upLeft: Color4.create(0.482, 0.380, 1.00, 1),
  upRight: Color4.create(0.00, 0.831, 1.00, 1),
}
const REVERSE_COLOR = Color4.create(1.00, 0.125, 0.259, 1)
const HIT_COLOR = Color4.create(1.00, 0.722, 0.00, 1)

const DIR_SYMBOL: Record<Direction, string> = {
  left:  '◀',
  down:  '▼',
  up:    '▲',
  right: '▶',
  upLeft: '↖',
  upRight: '↗',
}

const DIR_KEY: Record<Direction, string> = {
  left: '←', down: '↓', up: '↑', right: '→', upLeft: 'Q/1', upRight: 'E',
}

type PercentUnit = `${number}%`

const BEAT_SCORE_LOGO = 'assets/images/beatscore.png'
const JUDGMENT_GRADIENT = 'assets/images/ui/judgment-gradient.png'
const BUTTON_SOUND = 'public/sounds/decentraland-button.mp3'
let buttonSoundEntity = engine.RootEntity
let tutorialPage = 0

type ButtonTone = 'cyan' | 'magenta' | 'green' | 'gold'

const BUTTON_GRADIENTS: Record<ButtonTone, { top: Color4; bottom: Color4; border: Color4 }> = {
  cyan: {
    top: Color4.create(0.04, 0.74, 0.92, 0.98),
    bottom: Color4.create(0.02, 0.34, 0.60, 0.98),
    border: Color4.create(0.38, 0.94, 1.0, 1),
  },
  magenta: {
    top: Color4.create(0.94, 0.20, 0.72, 0.98),
    bottom: Color4.create(0.46, 0.05, 0.44, 0.98),
    border: Color4.create(1.0, 0.48, 0.92, 1),
  },
  green: {
    top: Color4.create(0.08, 0.76, 0.50, 0.98),
    bottom: Color4.create(0.02, 0.34, 0.28, 0.98),
    border: Color4.create(0.42, 1.0, 0.76, 1),
  },
  gold: {
    top: Color4.create(1.0, 0.68, 0.10, 0.98),
    bottom: Color4.create(0.68, 0.25, 0.04, 0.98),
    border: Color4.create(1.0, 0.86, 0.28, 1),
  },
}
const BUTTON_TEXTURES: Record<ButtonTone, string> = {
  cyan: 'assets/images/ui/button-cyan.png',
  magenta: 'assets/images/ui/button-magenta.png',
  green: 'assets/images/ui/button-green.png',
  gold: 'assets/images/ui/button-gold.png',
}

function playButtonSound(): void {
  if (buttonSoundEntity === engine.RootEntity) return
  AudioSource.playSound(buttonSoundEntity, BUTTON_SOUND, true)
}

function runButtonAction(action: () => void): void {
  playButtonSound()
  action()
}

function BeatScoreLogo({ compact = false }: { compact?: boolean }): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const width = compact ? (mobile ? 138 : 176) : (mobile ? 170 : 290)
  const height = compact ? (mobile ? 79 : 102) : (mobile ? 98 : 167)

  return (
    <UiEntity
      uiTransform={{ width, height, margin: { bottom: compact ? 2 : mobile ? 2 : 4 }, flexShrink: 0 }}
      uiBackground={{ texture: { src: BEAT_SCORE_LOGO }, textureMode: 'stretch' }}
    />
  )
}

function GradientFill({ tone }: { tone: ButtonTone }): ReactEcs.JSX.Element {
  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', pointerFilter: 'none' }}
      uiBackground={{ texture: { src: BUTTON_TEXTURES[tone] }, textureMode: 'stretch' }}
    />
  )
}

function MenuButton({
  label,
  tone,
  onClick,
  width,
  height,
  fontSize,
  marginBottom = 0,
}: {
  label: string
  tone: ButtonTone
  onClick: () => void
  width: number | PercentUnit
  height: number
  fontSize: number
  marginBottom?: number
}): ReactEcs.JSX.Element {
  const gradient = BUTTON_GRADIENTS[tone]

  return (
    <UiEntity
      uiTransform={{
        width,
        height,
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
        margin: { bottom: marginBottom },
        borderRadius: 16,
        borderWidth: 2,
        borderColor: gradient.border,
        overflow: 'hidden',
      }}
      uiBackground={{ color: gradient.bottom }}
      onMouseDown={() => runButtonAction(onClick)}
    >
      <GradientFill tone={tone} />
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { top: 0, left: 0 },
          width: '100%',
          height: '30%',
          pointerFilter: 'none',
        }}
        uiBackground={{ color: Color4.create(1, 1, 1, 0.10) }}
      />
      <Label
        value={label}
        fontSize={fontSize}
        color={Color4.White()}
        uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', zIndex: 2, pointerFilter: 'none' }}
        textAlign="middle-center"
      />
    </UiEntity>
  )
}

function KeyboardKey({ symbol, color, wide = false }: { symbol: string; color: Color4; wide?: boolean }): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const size = mobile ? 64 : 66
  const verticalTriangle = symbol === '▲' || symbol === '▼'

  return (
    <UiEntity
      uiTransform={{
        width: wide ? (mobile ? 150 : 210) : size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        margin: { left: mobile ? 3 : 5, right: mobile ? 3 : 5 },
        borderRadius: 12,
        borderWidth: 2,
        borderColor: color,
      }}
      uiBackground={{ color: Color4.create(color.r * 0.13, color.g * 0.13, color.b * 0.13, 0.96) }}
    >
      <Label value={symbol} font={wide ? 'sans-serif' : 'monospace'} fontSize={wide ? (mobile ? 27 : 25) : verticalTriangle ? (mobile ? 43 : 36) : (mobile ? 56 : 50)} color={Color4.White()}
        uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }} textAlign="middle-center" />
    </UiEntity>
  )
}

function TutorialProgress(): ReactEcs.JSX.Element {
  return (
    <UiEntity uiTransform={{ width: 108, height: 12, flexDirection: 'row', justifyContent: 'space-between', margin: { bottom: 12 } }}>
      {[0, 1, 2].map(index => (
        <UiEntity
          key={`tutorial-progress-${index}`}
          uiTransform={{ width: index === tutorialPage ? 44 : 24, height: 7, borderRadius: 4 }}
          uiBackground={{
            color: index === tutorialPage
              ? Color4.create(1.0, 0.80, 0.20, 1)
              : Color4.create(0.30, 0.34, 0.48, 0.72),
          }}
        />
      ))}
    </UiEntity>
  )
}

function SequenceVisual(): ReactEcs.JSX.Element {
  return (
    <UiEntity uiTransform={{ width: '100%', height: isMobile() ? 58 : 78, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
      <KeyboardKey symbol="◀" color={DIR_COLOR.left} />
      <KeyboardKey symbol="▲" color={DIR_COLOR.up} />
      <KeyboardKey symbol="▶" color={DIR_COLOR.right} />
      <KeyboardKey symbol="▼" color={DIR_COLOR.down} />
    </UiEntity>
  )
}

function DirectionPadVisual(): ReactEcs.JSX.Element {
  const mobile = isMobile()
  return (
    <UiEntity uiTransform={{ width: mobile ? 270 : 240, height: mobile ? 150 : 142, flexDirection: 'column', alignItems: 'center' }}>
      <UiEntity uiTransform={{ width: '100%', height: mobile ? 72 : 68, flexDirection: 'row', justifyContent: 'center' }}>
        <KeyboardKey symbol="▲" color={DIR_COLOR.up} />
      </UiEntity>
      <UiEntity uiTransform={{ width: '100%', height: mobile ? 72 : 68, flexDirection: 'row', justifyContent: 'center', margin: { top: mobile ? 6 : 6 } }}>
        <KeyboardKey symbol="◀" color={DIR_COLOR.left} />
        <KeyboardKey symbol="▼" color={DIR_COLOR.down} />
        <KeyboardKey symbol="▶" color={DIR_COLOR.right} />
      </UiEntity>
    </UiEntity>
  )
}

function TimingVisual(): ReactEcs.JSX.Element {
  const mobile = isMobile()
  return (
    <UiEntity uiTransform={{ width: mobile ? '88%' : 400, height: mobile ? 100 : 126, flexDirection: 'column', alignItems: 'center' }}>
      <UiEntity
        uiTransform={{ width: '100%', height: mobile ? 30 : 38, positionType: 'relative', borderRadius: 15, overflow: 'hidden', borderWidth: 1, borderColor: Color4.create(0.46, 0.66, 1, 0.75) }}
        uiBackground={{ color: Color4.create(0.03, 0.04, 0.12, 0.96) }}
      >
        <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: '72%' }, width: '20%', height: '100%' }}
          uiBackground={{ texture: { src: JUDGMENT_GRADIENT }, textureMode: 'stretch' }} />
        <UiEntity uiTransform={{ positionType: 'absolute', position: { top: mobile ? 4 : 5, left: '78%' }, width: mobile ? 22 : 28, height: mobile ? 22 : 28, borderRadius: 14 }}
          uiBackground={{ color: Color4.create(1, 0.94, 0.34, 1) }} />
      </UiEntity>
      <UiEntity uiTransform={{ width: '100%', height: mobile ? 56 : 72, alignItems: 'center', justifyContent: 'center', margin: { top: mobile ? 8 : 12 } }}>
        <KeyboardKey symbol={mobile ? 'JUMP / HIT' : 'SPACE / HIT'} color={Color4.create(1, 0.48, 0.84, 1)} wide />
      </UiEntity>
    </UiEntity>
  )
}

function TutorialSlide(): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const titles = ['READ THE SEQUENCE', 'ENTER THE MOVES', 'HIT THE BEAT']
  const descriptions = [
    'Follow the arrows from left to right.',
    mobile ? 'Tap the matching direction buttons.' : 'Press the matching arrow keys in order.',
    mobile ? 'Tap JUMP when the marker reaches the cyan center.' : 'Press SPACE when the marker reaches the cyan center.',
  ]

  const nextTutorialPage = (): void => {
    playButtonSound()
    tutorialPage = Math.min(3, tutorialPage + 1)
  }
  const previousTutorialPage = (): void => {
    playButtonSound()
    tutorialPage = Math.max(0, tutorialPage - 1)
  }

  return (
    <UiEntity uiTransform={{ width: '100%', height: mobile ? 360 : 330, flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start' }}>
      <TutorialProgress />
      <Label value={`STEP ${tutorialPage + 1}`} fontSize={mobile ? 25 : 19} color={Color4.create(1, 0.80, 0.20, 1)}
        uiTransform={{ width: '100%', height: mobile ? 34 : 27 }} textAlign="middle-center" />
      <Label value={titles[tutorialPage]} fontSize={mobile ? 42 : 34} color={Color4.White()}
        uiTransform={{ width: '100%', height: mobile ? 54 : 46, margin: { bottom: mobile ? 4 : 7 } }} textAlign="middle-center" />
      <Label value={descriptions[tutorialPage]} fontSize={mobile ? 27 : 20} color={Color4.create(0.74, 0.84, 0.96, 1)}
        uiTransform={{ width: '94%', height: mobile ? 42 : 34, margin: { bottom: mobile ? 8 : 14 } }} textAlign="middle-center" />

      <UiEntity uiTransform={{ width: '100%', height: mobile ? 142 : 146, alignItems: 'center', justifyContent: 'center' }}>
        {tutorialPage === 0 ? <SequenceVisual /> : null}
        {tutorialPage === 1 ? <DirectionPadVisual /> : null}
        {tutorialPage === 2 ? <TimingVisual /> : null}
      </UiEntity>

      <UiEntity uiTransform={{ width: mobile ? 560 : 400, height: mobile ? 64 : 58, flexDirection: 'row', justifyContent: tutorialPage === 0 ? 'center' : 'space-between', margin: { top: mobile ? 8 : 10 } }}>
        {tutorialPage > 0 ? (
          <UiEntity
            uiTransform={{ width: '30%', height: '100%', alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: Color4.create(0.52, 0.62, 0.82, 0.72) }}
            uiBackground={{ color: Color4.create(0.06, 0.07, 0.15, 0.90) }}
            onMouseDown={previousTutorialPage}
          >
            <Label value="BACK" fontSize={mobile ? 28 : 20} color={Color4.create(0.78, 0.86, 1, 1)}
              uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} textAlign="middle-center" />
          </UiEntity>
        ) : null}
        <MenuButton label={tutorialPage === 2 ? 'SHOW MENU' : 'NEXT'} tone={tutorialPage === 2 ? 'gold' : 'cyan'}
          onClick={nextTutorialPage} width={tutorialPage === 0 ? (mobile ? '68%' : 280) : '66%'} height={mobile ? 64 : 58} fontSize={mobile ? 32 : 25} />
      </UiEntity>
    </UiEntity>
  )
}

function getDanceModeDisplayLabel(): string {
  if (gameState.measureCount >= TOTAL_MEASURES - 1) return 'FINAL MOVE'
  return getRoundModeLabel(gameState.roundMode)
}

function CloseButton({ onClick }: { onClick: () => void }): ReactEcs.JSX.Element {
  const mobile = isMobile()
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 12, right: 12 },
        width: mobile ? 54 : 42,
        height: mobile ? 54 : 42,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: Color4.create(1.0, 0.40, 0.86, 0.85),
      }}
      uiBackground={{ color: Color4.create(0.04, 0.03, 0.08, 0.92) }}
      onMouseDown={() => runButtonAction(onClick)}
    >
      <Label
        value="X"
        fontSize={mobile ? 30 : 24}
        color={Color4.create(1.0, 0.62, 0.92, 1)}
        uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
        textAlign="middle-center"
      />
    </UiEntity>
  )
}

function BackButton({ onClick }: { onClick: () => void }): ReactEcs.JSX.Element {
  const mobile = isMobile()
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 12, left: 12 },
        width: mobile ? 112 : 96,
        height: mobile ? 52 : 42,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: Color4.create(0.42, 0.82, 1.0, 0.85),
      }}
      uiBackground={{ color: Color4.create(0.06, 0.06, 0.14, 0.92) }}
      onMouseDown={() => runButtonAction(onClick)}
    >
      <Label
        value="BACK"
        fontSize={mobile ? 22 : 18}
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
  const mobile = isMobile()
  const c = inverted ? REVERSE_COLOR : DIR_COLOR[displayDirection]
  const sym = state === 'done' && inverted ? DIR_SYMBOL[inputDirection] : DIR_SYMBOL[displayDirection]
  const horizontalTriangle = displayDirection === 'left' || displayDirection === 'right'

  let bg: Color4
  let fg: Color4

  switch (state) {
    case 'done':
      bg = HIT_COLOR
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
        width: mobile ? 56 : 58,
        height: mobile ? 56 : 58,
        margin: { left: mobile ? 2 : 3, right: mobile ? 2 : 3 },
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 1,
        borderRadius: mobile ? 8 : 10,
        borderWidth: state === 'active' ? 2 : 1,
        borderColor: Color4.create(fg.r, fg.g, fg.b, state === 'active' ? 0.90 : 0.36),
      }}
      uiBackground={{ color: bg }}
    >
      <Label
        value={sym}
        font="monospace"
        fontSize={horizontalTriangle ? (mobile ? 44 : 56) : (mobile ? 34 : 38)}
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
  const mobile = isMobile()
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
        position: { top: mobile ? 112 : 126, left: 0 },
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
          color={isReverseIntro ? REVERSE_COLOR : HIT_COLOR}
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
  const mobile = isMobile()
  const p = gameState.measureProgress
  const spaceWindow = getSpaceWindow()

  // How close is the ball to the judgment center? (0 = far, 1 = perfect)
  const distFromCenter  = Math.abs(p - JUDGMENT_CENTER)
  const jPulse          = Math.max(0, 1 - distFromCenter / 0.18)  // 1 at center, 0 outside ±0.18

  // The marker turns gold inside the score zone while the zone itself previews judgment quality.
  const inZone = p >= spaceWindow.start && p <= spaceWindow.end
  const ballColor = inZone
    ? Color4.create(1.0, 0.7 + jPulse * 0.3, 0.1 + jPulse * 0.1, 1)
    : Color4.create(0.4, 0.7, 1.0, 1)

  const visualZoneWidth = Math.max(spaceWindow.end - spaceWindow.start, 0.14)
  const visualZoneStart = Math.max(0, Math.min(1 - visualZoneWidth, JUDGMENT_CENTER - visualZoneWidth / 2))
  const jZoneLeft = `${(visualZoneStart * 100).toFixed(2)}%` as PercentUnit
  const jZoneWidth = `${(visualZoneWidth * 100).toFixed(2)}%` as PercentUnit
  const ballLeftPct = `${(p * 100).toFixed(2)}%` as PercentUnit

  // Space key: "hit" if space already pressed this measure
  const spaceFlash = gameState.spaceFlash
  const spaceColor = Color4.create(1, 0.9 + spaceFlash * 0.1, 0.2 + spaceFlash * 0.3, 0.6 + spaceFlash * 0.4)
  const hitLabel = mobile ? 'JUMP=HIT' : 'SPACE=HIT'

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: mobile
          ? { top: 174, left: '13%' }
          : { top: 204, left: 350, right: 305 },
        width: mobile ? '74%' : undefined,
        minWidth: mobile ? undefined : 420,
        height: mobile ? 78 : 82,
        flexDirection: 'column',
        borderRadius: 12,
      }}
    >
      {/* Row: labels above the track */}
      <UiEntity
        uiTransform={{
          width: '100%',
          height: mobile ? 22 : 24,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          margin: { bottom: 5 },
        }}
      >
        <Label
          value="TYPE SEQUENCE →"
          fontSize={mobile ? 19 : 15}
          color={Color4.create(0.5, 0.5, 0.5, 0.9)}
          uiTransform={{ width: mobile ? '52%' : 180, height: '100%' }}
          textAlign="middle-left"
        />
        <Label
          value={`← ${hitLabel}`}
          fontSize={mobile ? 19 : 15}
          color={spaceColor}
          uiTransform={{ width: mobile ? '46%' : 160, height: '100%' }}
          textAlign="middle-right"
        />
      </UiEntity>

      {/* Track */}
      <UiEntity
        uiTransform={{ width: '100%', height: mobile ? 38 : 42, positionType: 'relative', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: Color4.create(0.38, 0.56, 0.94, 0.66) }}
        uiBackground={{ color: Color4.create(0.04, 0.04, 0.10, 0.92) }}
      >
        {/* Continuous score gradient from BAD at the edges to PERFECT at center. */}
        <UiEntity
          uiTransform={{
            positionType: 'absolute',
            position: { top: 0, left: jZoneLeft },
            width: jZoneWidth,
            height: '100%',
            overflow: 'hidden',
          }}
          uiBackground={{ texture: { src: JUDGMENT_GRADIENT }, textureMode: 'stretch' }}
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
            position: { top: mobile ? 5 : 6, left: ballLeftPct },
            width: mobile ? 28 : 30,
            height: mobile ? 28 : 30,
            borderRadius: 15,
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
        width: mobile ? 190 : 225,
        height: mobile ? 96 : 108,
        flexDirection: 'column',
        alignItems: 'flex-end',
        padding: { top: mobile ? 9 : 10, right: mobile ? 12 : 14, bottom: 10, left: 10 },
        borderRadius: 14,
        borderWidth: 1,
        borderColor: Color4.create(0.30, 0.78, 1.0, 0.70),
      }}
      uiBackground={{ color: Color4.create(0, 0, 0, 0.55) }}
    >
      <Label
        value="POINTS"
        fontSize={mobile ? 17 : 19}
        color={Color4.create(0.35, 0.9, 1.0, 1)}
        uiTransform={{ width: '100%', height: mobile ? 20 : 22 }}
        textAlign="middle-right"
      />
      <Label
        value={String(gameState.score)}
        fontSize={mobile ? 30 : 35}
        color={Color4.create(1.0, 0.88, 0.18, 1)}
        uiTransform={{ width: '100%', height: mobile ? 34 : 40 }}
        textAlign="middle-right"
      />
      <Label
        value={`MAX PERFECT COMBO  ${gameState.maxCombo}`}
        fontSize={mobile ? 12 : 14}
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
        borderRadius: 14,
        borderWidth: 1,
        borderColor: Color4.create(1.0, 0.64, 0.18, 0.68),
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
        borderRadius: 14,
        borderWidth: 1,
        borderColor: Color4.create(color.r, color.g, color.b, 0.62),
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
        borderRadius: 14,
        borderWidth: 1,
        borderColor: Color4.create(1.0, 0.76, 0.22, 0.68),
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
                borderRadius: 10,
                borderWidth: player.isLocal ? 1 : 0,
                borderColor: Color4.create(0.40, 1.0, 0.85, 0.72),
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
        borderRadius: 12,
        borderWidth: 1,
        borderColor: Color4.create(0.72, 0.42, 1.0, 0.58),
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
        borderRadius: 12,
        borderWidth: 1,
        borderColor: Color4.create(0.34, 0.70, 1.0, 0.50),
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
  const rowHeight = compact ? (mobile ? 32 : 28) : mobile ? 34 : 30

  return (
    <UiEntity
      uiTransform={{
        width: compact ? '100%' : mobile ? '90%' : 410,
        height: compact ? (mobile ? 164 : 144) : mobile ? 172 : 158,
        flexDirection: 'column',
        padding: compact
          ? { top: 6, right: 6, bottom: 6, left: 6 }
          : { top: mobile ? 5 : 8, right: 10, bottom: mobile ? 5 : 8, left: 10 },
        margin: { bottom: compact ? 10 : mobile ? 9 : 14 },
      }}
    >
      <Label
        value={compact ? 'GOALS' : 'DAILY GOALS'}
        fontSize={compact ? (mobile ? 21 : 18) : mobile ? 24 : 22}
        color={Color4.create(0.52, 0.92, 1, 1)}
        uiTransform={{ width: '100%', height: compact ? 22 : mobile ? 26 : 30 }}
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
            fontSize={compact ? (mobile ? 18 : 15) : mobile ? 20 : 17}
            color={goal.completed ? Color4.create(0.42, 1, 0.58, 1) : Color4.create(0.82, 0.82, 0.9, 1)}
            uiTransform={{ width: compact ? '64%' : mobile ? '66%' : '70%', height: '100%' }}
            textAlign="middle-left"
          />
          <Label
            value={goal.completed ? `+${goal.rewardRp}` : `${goal.progress}/${goal.target}`}
            fontSize={compact ? (mobile ? 18 : 15) : mobile ? 20 : 17}
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
        borderRadius: Math.floor(size / 2),
        borderWidth: 3,
        borderColor: Color4.create(tone.r, tone.g, tone.b, 0.34),
      }}
      uiBackground={{ color: Color4.create(0.02, 0.01, 0.04, 0.90) }}
      uiInputBinding={{ actions: [action] }}
    >
      <UiEntity
        uiTransform={{
          width: size - 8,
          height: size - 8,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: Math.floor((size - 8) / 2),
          borderWidth: 2,
          borderColor: Color4.create(tone.r, tone.g, tone.b, 0.96),
        }}
        uiBackground={{ color: Color4.create(0.01, 0.01, 0.025, 0.96) }}
      >
        <Label
          value={label}
          fontSize={size > 70 ? 44 : 34}
          color={tone}
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
    <UiEntity uiTransform={{ positionType: 'absolute', position: { bottom: 14, left: 0 }, width: '100%', height: 252 }}>
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { bottom: 0, left: 18 },
          width: 250,
          height: 250,
        }}
      >
        <OfficialTouchButton action={InputAction.IA_ACTION_5} label="⌃" x={84} y={0} size={82} tone={DIR_COLOR.up} />
        <OfficialTouchButton action={InputAction.IA_ACTION_3} label="‹" x={0} y={84} size={82} tone={DIR_COLOR.left} />
        <OfficialTouchButton action={InputAction.IA_ACTION_4} label="›" x={168} y={84} size={82} tone={DIR_COLOR.right} />
        <OfficialTouchButton action={InputAction.IA_ACTION_6} label="⌄" x={84} y={168} size={82} tone={DIR_COLOR.down} />
        <UiEntity
          uiTransform={{
            positionType: 'absolute',
            position: { left: 101, top: 101 },
            width: 48,
            height: 48,
            borderRadius: 24,
          }}
          uiBackground={{ color: Color4.create(0.01, 0.01, 0.025, 0.78) }}
        />
      </UiEntity>

      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { bottom: 0, right: 16 },
          width: 154,
          height: 154,
        }}
      >
        <UiEntity
          uiTransform={{
            positionType: 'absolute',
            position: { right: 0, bottom: 0 },
            width: 154,
            height: 154,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 77,
            borderWidth: 3,
            borderColor: Color4.create(HIT_COLOR.r, HIT_COLOR.g, HIT_COLOR.b, 0.42),
          }}
          uiBackground={{ color: Color4.create(0.02, 0.01, 0.015, 0.92) }}
          uiInputBinding={{ actions: [InputAction.IA_JUMP] }}
        >
          <UiEntity
            uiTransform={{ width: 142, height: 142, alignItems: 'center', justifyContent: 'center', borderRadius: 71, borderWidth: 3, borderColor: HIT_COLOR }}
            uiBackground={{ color: Color4.create(0.07, 0.035, 0.01, 0.96) }}
          >
            <Label
              value="★"
              fontSize={76}
              color={HIT_COLOR}
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
            borderRadius: 8,
            borderWidth: 1,
            borderColor: Color4.create(DIR_COLOR[d].r, DIR_COLOR[d].g, DIR_COLOR[d].b, 0.46),
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
            borderRadius: 8,
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
          borderRadius: 8,
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
  const buttonWidth = mobile ? '76%' : 400
  const replayTutorial = (): void => {
    playButtonSound()
    tutorialPage = 0
  }

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <UiEntity
        uiTransform={{
          positionType: 'relative',
          width: mobile ? 760 : 560,
          height: mobile ? 560 : 620,
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          padding: { top: mobile ? 8 : 12, bottom: mobile ? 10 : 16, left: mobile ? 14 : 26, right: mobile ? 14 : 26 },
          borderRadius: mobile ? 20 : 24,
          borderWidth: 2,
          borderColor: Color4.create(0.46, 0.58, 1.0, 0.78),
        }}
        uiBackground={{ color: Color4.create(0.012, 0.012, 0.045, 0.94) }}
      >
        <CloseButton onClick={watchLiveMode} />
        <BeatScoreLogo />
        <Label value={`${gameState.danceRank}  •  ${gameState.rankPoints} RP`} fontSize={mobile ? 30 : 22}
          color={Color4.create(0.46, 0.92, 1.0, 1)}
          uiTransform={{ width: '100%', height: mobile ? 26 : 32, margin: { bottom: mobile ? 8 : 12 } }} textAlign="middle-center" />

        {tutorialPage < 3 ? <TutorialSlide /> : (
          <UiEntity uiTransform={{ width: '100%', height: mobile ? 390 : 375, flexDirection: 'column', alignItems: 'center' }}>
            <UiEntity
              uiTransform={{ width: 190, height: mobile ? 28 : 34, alignItems: 'center', justifyContent: 'center', margin: { bottom: mobile ? 4 : 8 } }}
              onMouseDown={replayTutorial}
            >
              <Label value="↻  REPLAY TUTORIAL" fontSize={mobile ? 24 : 17} color={Color4.create(0.66, 0.78, 1, 1)}
                uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} textAlign="middle-center" />
            </UiEntity>
            <DailyGoalsMenuCard />
            <MenuButton label="DANCE" tone="cyan" onClick={openPlayMenu} width={buttonWidth}
              height={mobile ? 70 : 64} fontSize={mobile ? 36 : 30} marginBottom={mobile ? 12 : 13} />
            <MenuButton label="JUST WATCH" tone="magenta" onClick={watchLiveMode} width={buttonWidth}
              height={mobile ? 70 : 64} fontSize={mobile ? 34 : 28} />
          </UiEntity>
        )}
      </UiEntity>
    </UiEntity>
  )
}

function IdleScreen(): ReactEcs.JSX.Element {
  const mobile = isMobile()
  const buttonWidth = mobile ? '88%' : 360

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <UiEntity
        uiTransform={{
          positionType: 'relative',
        width: mobile ? '66%' : 520,
        maxWidth: mobile ? 820 : 520,
        height: mobile ? '72%' : 430,
        maxHeight: mobile ? 560 : 430,
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: { top: mobile ? 12 : 22, bottom: mobile ? 12 : 22, left: mobile ? 14 : 24, right: mobile ? 14 : 24 },
          borderRadius: mobile ? 20 : 24,
          borderWidth: 2,
          borderColor: Color4.create(0.56, 0.38, 0.92, 0.82),
        }}
        uiBackground={{ color: Color4.create(0.012, 0.012, 0.045, 0.94) }}
      >
        <BackButton onClick={returnToLobby} />
        <CloseButton onClick={watchLiveMode} />
        <BeatScoreLogo compact />
        <Label value={`${gameState.danceRank}  •  ${gameState.rankPoints} RP`} fontSize={mobile ? 23 : 19}
          color={Color4.create(0.46, 0.92, 1.0, 1)}
          uiTransform={{ width: '100%', height: mobile ? 24 : 28, margin: { bottom: mobile ? 3 : 6 } }} textAlign="middle-center" />
        <Label value="CHOOSE YOUR MODE" fontSize={mobile ? 28 : 24}
          color={Color4.create(1.0, 0.84, 0.24, 1)}
          uiTransform={{ width: '100%', height: mobile ? 30 : 38, margin: { bottom: mobile ? 7 : 12 } }} textAlign="middle-center" />
        <MenuButton label="MULTIPLAYER" tone="green" onClick={readyForMultiplayer} width={buttonWidth}
          height={mobile ? 64 : 64} fontSize={mobile ? 30 : 26} marginBottom={mobile ? 12 : 13} />
        <MenuButton label="SOLO MODE" tone="magenta" onClick={startSoloMode} width={buttonWidth}
          height={mobile ? 64 : 64} fontSize={mobile ? 30 : 26} />
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
        position: mobile ? { top: '3%', left: '3%' } : { top: '11%', left: '26.5%' },
        width: mobile ? '94%' : '47%',
        height: mobile ? '94%' : 530,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        padding: { top: mobile ? 12 : 22, bottom: mobile ? 12 : 22, left: mobile ? 12 : 22, right: mobile ? 12 : 22 },
        borderRadius: mobile ? 20 : 24,
        borderWidth: 2,
        borderColor: Color4.create(0.38, 0.90, 0.74, 0.82),
      }}
      uiBackground={{ color: Color4.create(0.01, 0.02, 0.045, 0.94) }}
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
      <UiEntity uiTransform={{ width: '100%', height: mobile ? 66 : 78, alignItems: 'center', justifyContent: 'center', margin: { top: mobile ? 8 : 12 } }}>
        <MenuButton label={localIsReady ? 'READY' : 'GET READY'} tone={localIsReady ? 'green' : 'cyan'}
          onClick={toggleMultiplayerReady} width={buttonWidth} height={mobile ? 54 : 62} fontSize={mobile ? 23 : 27} />
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
        position: mobile ? { top: '4%', right: '5%' } : { top: '14%', right: 22 },
        width: mobile ? '90%' : 250,
        minWidth: mobile ? 220 : 250,
        maxWidth: mobile ? 310 : 250,
        height: mobile ? '92%' : 430,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        padding: { top: 6, right: 10, bottom: 8, left: 10 },
        borderRadius: 16,
        borderWidth: 1,
        borderColor: Color4.create(0.48, 0.56, 0.92, 0.72),
      }}
      uiBackground={{ color: Color4.create(0.01, 0.01, 0.05, 0.78) }}
    >
      <BeatScoreLogo compact />
      <UiEntity
        uiTransform={{ width: '100%', height: mobile ? 44 : 50, alignItems: 'center', justifyContent: 'center', margin: { bottom: 8 } }}
      >
        <Label
          value={`${gameState.danceRank}\n${gameState.rankPoints} RP`}
          fontSize={mobile ? 19 : 20}
          color={Color4.create(1.0, 0.82, 0.22, 1)}
          uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
          textAlign="middle-center"
        />
      </UiEntity>
      <MenuButton label="MULTI" tone="green" onClick={readyForMultiplayer} width={'100%'}
        height={mobile ? 58 : 62} fontSize={mobile ? 25 : 27} marginBottom={10} />
      <MenuButton label="SOLO" tone="magenta" onClick={startSoloMode} width={'100%'}
        height={mobile ? 58 : 62} fontSize={mobile ? 25 : 27} />
      <DailyGoalsMenuCard compact />
    </UiEntity>
  )
}

function JumpOffButton(): ReactEcs.JSX.Element {
  const mobile = isMobile()
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: mobile ? 180 : 194, right: mobile ? 12 : 24 },
        width: mobile ? 190 : 170,
        height: mobile ? 54 : 46,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        borderWidth: 2,
        borderColor: Color4.create(REVERSE_COLOR.r, REVERSE_COLOR.g, REVERSE_COLOR.b, 0.92),
      }}
      uiBackground={{ color: Color4.create(0.18, 0.02, 0.06, 0.90) }}
      onMouseDown={() => runButtonAction(returnToLobby)}
    >
      <Label
        value="JUMP OFF"
        fontSize={mobile ? 25 : 21}
        color={Color4.create(1.0, 0.76, 0.84, 1)}
        uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }}
        textAlign="middle-center"
      />
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
        position: { top: 0, left: 0 },
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <UiEntity
        uiTransform={{
        width: mobile ? 720 : '63%',
        height: mobile ? 460 : 468,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        padding: { top: mobile ? 12 : 20, bottom: mobile ? 12 : 20, left: mobile ? 12 : 22, right: mobile ? 12 : 22 },
        borderRadius: mobile ? 20 : 24,
        borderWidth: 2,
        borderColor: Color4.create(0.76, 0.42, 1.0, 0.78),
      }}
      uiBackground={{ color: Color4.create(0, 0, 0, 0.85) }}
    >
      <Label value="RESULTS" fontSize={mobile ? 42 : 50}
        color={Color4.create(0.85, 0.85, 0.85, 1)}
        uiTransform={{ width: '100%', height: mobile ? 48 : 58 }} textAlign="middle-center" />

      <Label value={starText} fontSize={mobile ? 54 : 91}
        color={starColor}
        uiTransform={{ width: '100%', height: mobile ? 64 : 104 }} textAlign="middle-center" />

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
              uiTransform={{ width: '100%', height: mobile ? 22 : 30, margin: { bottom: 2 }, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: { left: 10, right: 10 }, borderRadius: 8 }}
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
      <MenuButton label="CONTINUE" tone="cyan" onClick={returnToLobby} width={mobile ? 420 : 360}
        height={mobile ? 58 : 54} fontSize={mobile ? 28 : 24} />
      </UiEntity>
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
          {!isMobile() ? <RankAvatarBadge /> : null}
          {!isMobile() ? <DailyGoalsPanel /> : null}
          <KeynoteBar />
          {gameState.roundState === 'active' ? <RhythmTimeline /> : null}
          <JumpOffButton />
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
  buttonSoundEntity = engine.addEntity()
  AudioSource.create(buttonSoundEntity, {
    audioClipUrl: BUTTON_SOUND,
    playing: false,
    volume: 0.55,
    loop: false,
    global: true,
  })
  ReactEcsRenderer.setUiRenderer(AuditionUI)
}
