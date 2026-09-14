import {
  AudioSource,
  engine,
  inputSystem,
  InputAction,
  InputModifier,
  MainCamera,
  PointerEventType,
  TouchScreenControls,
  Transform,
  VirtualCamera,
} from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { MessageBus } from '@dcl/sdk/message-bus'
import { isMobile } from '@dcl/sdk/platform'
import { getPlayer, onEnterScene, onLeaveScene } from '@dcl/sdk/players'
import { movePlayerTo, triggerEmote } from '~system/RestrictedActions'
import {
  Direction,
  BEAT_DURATION,
  MEASURE_DURATION,
  TOTAL_MEASURES,
} from './beatmap'

// ──────────────────────────────────────────────────────────
// Judgment zone
// ──────────────────────────────────────────────────────────
// The rhythm ball travels from measureProgress=0 to 1 each measure.
// The "optimal" Space press is at JUDGMENT_CENTER.
// Space is only accepted once the ball enters the active timing window.
export const JUDGMENT_CENTER     = 0.875

// Timing windows (seconds from JUDGMENT_CENTER moment)
export const PERFECT_WINDOW = 0.035   // ±35 ms
export const GREAT_WINDOW   = 0.075   // ±75 ms
export const COOL_WINDOW    = 0.120   // ±120 ms
export const BAD_WINDOW     = 0.180   // ±180 ms
const MIN_HIT_WINDOW_PROGRESS = 0.07

// ──────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────
export type JudgmentText = 'PERFECT!' | 'GREAT!' | 'COOL!' | 'BAD!' | 'MISS!'
export type RoundMode = 'easy' | 'middle' | 'freestyle' | 'hard'
export type RoundState = 'active' | 'waiting'
export type PlayMode = 'none' | 'solo' | 'multiplayer'
export type LobbyPrompt = 'choice' | 'play' | 'hidden'

export interface SequenceStep {
  displayDirection: Direction
  inputDirection: Direction
  inverted: boolean
}

export interface Judgment {
  text: JudgmentText
  timer: number
  totalDuration: number
}

export interface DailyGoal {
  id: 'perfect_hits' | 'perfect_combo' | 'finish_song' | 'score_total' | 'great_hits' | 'cool_hits' | 'multiplayer_match'
  label: string
  progress: number
  target: number
  rewardRp: number
  completed: boolean
}

export interface MatchPlayer {
  playerId: string
  name: string
  score: number
  maxCombo: number
  rankPoints: number
  wins: number
  matchesPlayed: number
  slotIndex: number
  finished: boolean
  ready: boolean
  phase: GameState['phase']
  matchStartTime: number
  judgmentText: JudgmentText | ''
  judgmentCombo: number
  judgmentSentAt: number
  judgmentTimer: number
  isLocal: boolean
  lastSeen: number
}

export interface GameState {
  phase: 'idle' | 'ready' | 'playing' | 'gameover'
  playMode: PlayMode
  lobbyPrompt: LobbyPrompt
  roundState: RoundState
  roundMode: RoundMode
  waitTimer: number
  waitDuration: number
  roundDuration: number
  score: number
  combo: number
  maxCombo: number
  perfectHits: number
  greatHits: number
  coolHits: number
  badHits: number
  misses: number
  measureCount: number        // measures elapsed (game ends at TOTAL_MEASURES)
  runFinishedAwarded: boolean

  // Rhythm
  measureTime: number         // seconds elapsed in this measure
  measureProgress: number     // 0 → 1 within the measure
  currentBeat: number         // global beat index (read by dancefloor)
  beatPulse: number           // 1.0 on beat, decays to 0

  // Sequence for this measure
  currentSequence: SequenceStep[]
  inputIndex: number          // how many arrows correctly entered so far
  sequenceFailed: boolean     // wrong arrow pressed — sequence broken

  // Space hit
  spacePressed: boolean       // has Space been pressed this measure?

  // Visuals
  judgment: Judgment | null
  keyFlash: Record<Direction, number>   // 1.0 on press, decays to 0
  spaceFlash: number                    // 1.0 on Space press, decays

  // Retention / multiplayer prototype
  rankPoints: number
  danceRank: string
  nextRankPoints: number
  rankProgress: number
  dailyGoals: DailyGoal[]
  matchPlayers: MatchPlayer[]
  matchWinnerName: string
  winnerPlayerId: string
  winnerCelebrationTimer: number
  globalLeaderboard: MatchPlayer[]
  multiplayerReadyWindow: number
  multiplayerCountdown: number
  multiplayerLiveRemaining: number
}

const DANCE_RANKS = [
  { name: 'Street Rookie', points: 0 },
  { name: 'Beat Apprentice', points: 100 },
  { name: 'Club Regular', points: 250 },
  { name: 'Spotlight Ace', points: 500 },
  { name: 'Dance Royalty', points: 900 },
]

declare const localStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void } | undefined

const SAVE_KEY_PREFIX = 'dropbeat-progress-v3'

function getDailySeed(): string {
  const now = new Date()
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
}

function getGoalScale(rankPoints: number): number {
  if (rankPoints >= 900) return 3
  if (rankPoints >= 500) return 2.4
  if (rankPoints >= 250) return 1.8
  if (rankPoints >= 100) return 1.35
  return 1
}

function createDailyGoals(rankPoints = 0, daySeed = getDailySeed()): DailyGoal[] {
  const scale = getGoalScale(rankPoints)
  const rng = seededRandom(hashString(`${daySeed}-${Math.floor(rankPoints / 100)}`))
  const pool: DailyGoal[] = [
    { id: 'perfect_hits', label: `${Math.round(5 * scale)} PERFECT`, progress: 0, target: Math.round(5 * scale), rewardRp: Math.round(35 * scale), completed: false },
    { id: 'perfect_combo', label: `${Math.round(4 + scale)}x PERFECT`, progress: 0, target: Math.round(4 + scale), rewardRp: Math.round(40 * scale), completed: false },
    { id: 'score_total', label: `${Math.round(12000 * scale)} SCORE`, progress: 0, target: Math.round(12000 * scale), rewardRp: Math.round(30 * scale), completed: false },
    { id: 'great_hits', label: `${Math.round(6 * scale)} GREAT+`, progress: 0, target: Math.round(6 * scale), rewardRp: Math.round(28 * scale), completed: false },
    { id: 'cool_hits', label: `${Math.round(10 * scale)} COOL+`, progress: 0, target: Math.round(10 * scale), rewardRp: Math.round(24 * scale), completed: false },
    { id: 'finish_song', label: 'FINISH SONG', progress: 0, target: 1, rewardRp: Math.round(55 * scale), completed: false },
    { id: 'multiplayer_match', label: 'PLAY MULTI', progress: 0, target: 1, rewardRp: Math.round(45 * scale), completed: false },
  ]

  return pool
    .map(goal => ({ goal, roll: rng() }))
    .sort((a, b) => a.roll - b.roll)
    .slice(0, 3)
    .map(item => item.goal)
}

// ──────────────────────────────────────────────────────────
// Shared mutable state — read by ui.tsx and dancefloor.ts
// ──────────────────────────────────────────────────────────
export const gameState: GameState = {
  phase: 'idle',
  playMode: 'none',
  lobbyPrompt: 'choice',
  roundState: 'active',
  roundMode: 'easy',
  waitTimer: 0,
  waitDuration: 0,
  roundDuration: MEASURE_DURATION,
  score: 0,
  combo: 0,
  maxCombo: 0,
  perfectHits: 0,
  greatHits: 0,
  coolHits: 0,
  badHits: 0,
  misses: 0,
  measureCount: 0,
  runFinishedAwarded: false,
  measureTime: 0,
  measureProgress: 0,
  currentBeat: 0,
  beatPulse: 0,
  currentSequence: [],
  inputIndex: 0,
  sequenceFailed: false,
  spacePressed: false,
  judgment: null,
  keyFlash: { left: 0, down: 0, up: 0, right: 0, upLeft: 0, upRight: 0 },
  spaceFlash: 0,
  rankPoints: 0,
  danceRank: DANCE_RANKS[0].name,
  nextRankPoints: DANCE_RANKS[1].points,
  rankProgress: 0,
  dailyGoals: createDailyGoals(),
  matchPlayers: [],
  matchWinnerName: '',
  winnerPlayerId: '',
  winnerCelebrationTimer: 0,
  globalLeaderboard: [],
  multiplayerReadyWindow: 0,
  multiplayerCountdown: 0,
  multiplayerLiveRemaining: 0,
}

// ──────────────────────────────────────────────────────────
// Internal
// ──────────────────────────────────────────────────────────
let totalBeats = 0
let playerMovementLocked = false
let touchControlsHidden = false
let cinematicReady = false
let cinematicCameraActive = false
let cinematicTime = 0
let hitCinematicTimer = 0
let hitSoundEntity = engine.RootEntity
let arrowClapSoundEntity = engine.RootEntity
let arrowFailSoundEntity = engine.RootEntity
let matchMusicEntity = engine.RootEntity
let cinematicTargetEntity = engine.RootEntity
let cinematicCameraEntity = engine.RootEntity
let cinematicCameraPosition = Vector3.create(16, 2.6, 7.4)
let cinematicCameraFov = 58
let multiplayerSyncTimer = 0
let lastReadyWindowRemaining = 0
let winnerCelebrationStarted = false
let matchSlotsLocked = false
let postGameReturnTimer = 0
let multiplayerMatchStartTimeMs = 0
let syncedMultiplayerMeasure = -1
let syncedMultiplayerState: RoundState | null = null
let localAudienceSlotIndex = -1
let localAudienceSlotPlayerId = ''
let audienceEnforceTimer = 0
let remoteLiveMatchTimer = 0
let remoteLiveMatchStartTimeMs = 0
let cachedMultiplayerMatchDuration = 0
let localMatchElapsed = 0

const ALL_DIRS: Direction[] = ['left', 'down', 'up', 'right', 'upLeft', 'upRight']
const BASIC_DIRS: Direction[] = ['left', 'down', 'up', 'right']
const HARD_DIRS: Direction[] = ['left', 'down', 'up', 'right']
const INITIAL_COMBO_WAIT = 3.0
const SESSION_AUDIENCE_ID = `guest-${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`
const DANCE_FLOOR_MIN_X = 7.4
const DANCE_FLOOR_MAX_X = 24.6
const DANCE_FLOOR_MIN_Z = 7.4
const DANCE_FLOOR_MAX_Z = 24.6
// Keep the song length stable while moving 2.5 seconds from downtime into each playable sequence.
const WAIT_MIN = 0.5
const WAIT_MAX = 1.5
const MULTIPLAYER_READY_WINDOW = 60.0
const MULTIPLAYER_READY_WINDOW_MS = MULTIPLAYER_READY_WINDOW * 1000
const MULTIPLAYER_SCORE_CHANNEL = 'rhythm-hit-score-v2'
const MULTIPLAYER_SYNC_INTERVAL = 1.5
const STALE_MATCH_PLAYER_MS = 20000
const MATCH_START_TOLERANCE_MS = 2500

const multiplayerBus = new MessageBus()

const DANCE_SLOTS = [
  Vector3.create(16.0, 0, 10.9),
  Vector3.create(13.0, 0, 10.9),
  Vector3.create(19.0, 0, 10.9),
  Vector3.create(10.0, 0, 10.9),
  Vector3.create(22.0, 0, 10.9),
  Vector3.create(16.0, 0, 13.5),
  Vector3.create(13.0, 0, 13.5),
  Vector3.create(19.0, 0, 13.5),
  Vector3.create(10.0, 0, 13.5),
  Vector3.create(22.0, 0, 13.5),
  Vector3.create(16.0, 0, 16.1),
  Vector3.create(13.0, 0, 16.1),
  Vector3.create(19.0, 0, 16.1),
  Vector3.create(10.0, 0, 16.1),
  Vector3.create(22.0, 0, 16.1),
  Vector3.create(16.0, 0, 18.7),
  Vector3.create(13.0, 0, 18.7),
  Vector3.create(19.0, 0, 18.7),
  Vector3.create(10.0, 0, 18.7),
  Vector3.create(22.0, 0, 18.7),
]

const SOLO_DANCE_SLOT = Vector3.create(16.0, 0, 21.4)

function createAudienceSlots(): Vector3[] {
  const slots: Vector3[] = []

  for (let z = 9; z <= 23; z += 2) {
    slots.push(Vector3.create(5.0, 1.1, z))
    slots.push(Vector3.create(4.0, 1.9, z))
    slots.push(Vector3.create(3.0, 2.7, z))
    slots.push(Vector3.create(27.0, 1.1, z))
    slots.push(Vector3.create(28.0, 1.9, z))
    slots.push(Vector3.create(29.0, 2.7, z))
  }

  for (let x = 8; x <= 24; x += 2) {
    slots.push(Vector3.create(x, 1.1, 26.5))
    slots.push(Vector3.create(x, 1.9, 28.0))
    slots.push(Vector3.create(x, 2.7, 29.5))
  }

  return slots
}

const AUDIENCE_SLOTS = createAudienceSlots()

interface ScorePayload {
  playerId: string
  name: string
  score: number
  maxCombo: number
  rankPoints: number
  wins: number
  matchesPlayed: number
  ready: boolean
  finished: boolean
  measureCount: number
  phase: GameState['phase']
  sentAt: number
  matchStartTime: number
  judgmentText?: JudgmentText | ''
  judgmentCombo?: number
  judgmentSentAt?: number
}

function getNextMultiplayerMatchStartMs(): number {
  return Math.floor(Date.now() / MULTIPLAYER_READY_WINDOW_MS) * MULTIPLAYER_READY_WINDOW_MS + MULTIPLAYER_READY_WINDOW_MS
}

function getGlobalMultiplayerReadyWindow(): number {
  const startTime = multiplayerMatchStartTimeMs > 0 ? multiplayerMatchStartTimeMs : getNextMultiplayerMatchStartMs()
  return Math.max(0, (startTime - Date.now()) / 1000)
}

function syncGlobalMultiplayerWindow(): number {
  const remaining = getGlobalMultiplayerReadyWindow()
  gameState.multiplayerReadyWindow = remaining
  return remaining
}

function getMultiplayerMatchDuration(): number {
  if (cachedMultiplayerMatchDuration > 0) return cachedMultiplayerMatchDuration
  cachedMultiplayerMatchDuration = MATCH_MUSIC_DURATION
  return cachedMultiplayerMatchDuration
}

function getBaseComboWaitDuration(measureCount: number): number {
  if (measureCount <= 0) return INITIAL_COMBO_WAIT

  const rng = seededRandom(0x51A7E + measureCount * 193)
  return WAIT_MIN + rng() * (WAIT_MAX - WAIT_MIN)
}

function syncMultiplayerLiveRemaining(): number {
  const liveStartTime = remoteLiveMatchStartTimeMs > 0 ? remoteLiveMatchStartTimeMs : multiplayerMatchStartTimeMs
  if (remoteLiveMatchTimer <= 0 || liveStartTime <= 0) {
    gameState.multiplayerLiveRemaining = 0
    return 0
  }

  const elapsed = Math.max(0, (Date.now() - liveStartTime) / 1000)
  const remaining = Math.max(0, getMultiplayerMatchDuration() - elapsed)
  gameState.multiplayerLiveRemaining = remaining
  if (remaining <= 0) remoteLiveMatchTimer = 0
  return remaining
}

function resetMultiplayerReadyWindow(): void {
  const remaining = syncGlobalMultiplayerWindow()
  gameState.waitTimer = remaining
  gameState.waitDuration = MULTIPLAYER_READY_WINDOW
  gameState.multiplayerCountdown = remaining
  lastReadyWindowRemaining = remaining
}

function tickLobbyMatchWindow(): void {
  if (gameState.phase !== 'idle' || gameState.playMode !== 'none') return
  syncGlobalMultiplayerWindow()
  syncMultiplayerLiveRemaining()
}

function isQueuedReadyPlayer(player: MatchPlayer): boolean {
  return player.ready && player.phase === 'ready'
}

function isActiveMatchPlayer(player: MatchPlayer): boolean {
  return player.ready && (player.phase === 'playing' || player.phase === 'gameover')
}

function isSameScheduledMatch(matchStartTime: number): boolean {
  return (
    multiplayerMatchStartTimeMs > 0 &&
    matchStartTime > 0 &&
    Math.abs(matchStartTime - multiplayerMatchStartTimeMs) <= MATCH_START_TOLERANCE_MS
  )
}

function getQueuedReadyPlayers(): MatchPlayer[] {
  return gameState.matchPlayers.filter(isQueuedReadyPlayer)
}

function syncLocalReadyPlayerForScheduledMatch(): void {
  if (gameState.phase !== 'ready' || gameState.playMode !== 'multiplayer') return

  const local = ensureLocalMatchPlayer()
  local.phase = 'ready'
  local.matchStartTime = multiplayerMatchStartTimeMs
  if (local.ready) local.finished = false
}

function getScheduledMatchParticipants(): MatchPlayer[] {
  return gameState.matchPlayers.filter(player =>
    player.ready &&
    (player.phase === 'ready' || player.phase === 'playing') &&
    isSameScheduledMatch(player.matchStartTime)
  )
}

function startNewReadyMinute(): number {
  remoteLiveMatchStartTimeMs = 0
  multiplayerMatchStartTimeMs = getNextMultiplayerMatchStartMs()
  const remaining = syncGlobalMultiplayerWindow()
  gameState.waitTimer = remaining
  gameState.waitDuration = MULTIPLAYER_READY_WINDOW
  gameState.multiplayerCountdown = remaining
  lastReadyWindowRemaining = remaining
  if (gameState.phase === 'ready' && gameState.playMode === 'multiplayer') {
    const local = ensureLocalMatchPlayer()
    local.phase = 'ready'
    local.matchStartTime = multiplayerMatchStartTimeMs
  }
  return remaining
}

function tickMultiplayerReadyWindow(): void {
  if (gameState.phase !== 'ready' || gameState.playMode !== 'multiplayer') return

  const liveRemaining = syncMultiplayerLiveRemaining()
  if (liveRemaining > 0) {
    gameState.waitTimer = liveRemaining
    gameState.waitDuration = Math.max(gameState.waitDuration, liveRemaining)
    gameState.multiplayerCountdown = liveRemaining
    lastReadyWindowRemaining = liveRemaining
    return
  }

  if (multiplayerMatchStartTimeMs <= 0) startNewReadyMinute()

  const remaining = syncGlobalMultiplayerWindow()
  gameState.waitTimer = remaining
  gameState.multiplayerCountdown = remaining
  lastReadyWindowRemaining = remaining
  syncLocalReadyPlayerForScheduledMatch()

  if (Date.now() >= multiplayerMatchStartTimeMs) {
    const participants = getScheduledMatchParticipants()
    const local = getLocalPlayerIdentity()
    if (participants.length >= 2 && participants.some(player => player.playerId === local.playerId)) {
      startGame('multiplayer')
    } else {
      startNewReadyMinute()
      publishScore(false)
    }
  }
}

const ROUND_DURATIONS: Record<RoundMode, number> = {
  easy: MEASURE_DURATION + 2.5,
  middle: 5.3,
  freestyle: 5.85,
  hard: 6.5,
}

const MODE_SCORE_MULTIPLIER: Record<RoundMode, number> = {
  easy: 1.0,
  middle: 1.15,
  freestyle: 2.0,
  hard: 1.75,
}

const INVERTED_INPUT: Record<Direction, Direction> = {
  left: 'right',
  right: 'left',
  up: 'down',
  down: 'up',
  upLeft: 'upRight',
  upRight: 'upLeft',
}

const MODE_LABELS: Record<RoundMode, string> = {
  easy: 'EASY',
  middle: 'INTERMEDIATE',
  freestyle: 'REVERSE STYLE',
  hard: 'HARD',
}

const COMBO_EMOTE_TRACK = [
  'disco',
  'robot',
  'tik',
  'disco',
  'robot',
  'tik',
]
const FAIL_EMOTE = 'shrug'
const FACE_GLOBAL_LEADERBOARD_ROTATION = Quaternion.fromEulerDegrees(0, 180, 0)
const HIT_CINEMATIC_APPROACH = 1.45
const HIT_CINEMATIC_HOLD = 4.0
const HIT_CINEMATIC_RELEASE = 2.45
const HIT_CINEMATIC_DURATION = HIT_CINEMATIC_APPROACH + HIT_CINEMATIC_HOLD + HIT_CINEMATIC_RELEASE
const WINNER_CELEBRATION_DURATION = 8.0
const WINNER_EMOTE = 'disco'
const LOSER_EMOTE = 'dontsee'
const HIT_SOUND_URL = 'public/sounds/clap.mp3'
const ARROW_CLAP_SOUND_URL = 'public/sounds/clap-arrow.mp3'
const ARROW_FAIL_SOUND_URL = 'public/sounds/fail-arrow.mp3'
const MATCH_MUSIC_URL = 'public/sounds/beatdropmusic.mp3'
const MATCH_MUSIC_DURATION = 158.832
const POST_GAME_RESULT_DURATION = 6.0

function playPredefinedEmote(predefinedEmote: string): void {
  void triggerEmote({ predefinedEmote }).catch(() => {})
}

function playComboSuccessEmote(combo: number): void {
  const trackIndex = Math.max(combo - 1, 0) % COMBO_EMOTE_TRACK.length
  playPredefinedEmote(COMBO_EMOTE_TRACK[trackIndex])
}

function playGoodDanceEmote(seed: number): void {
  const trackIndex = Math.max(seed, 0) % COMBO_EMOTE_TRACK.length
  playPredefinedEmote(COMBO_EMOTE_TRACK[trackIndex])
}

function playComboFailEmote(): void {
  playPredefinedEmote(FAIL_EMOTE)
}

function getLocalDanceSlotPosition(): Vector3 {
  if (gameState.playMode === 'solo') return SOLO_DANCE_SLOT

  const local = getLocalPlayerIdentity()
  const entry = gameState.matchPlayers.find(player => player.playerId === local.playerId)
  return DANCE_SLOTS[(entry?.slotIndex ?? 0) % DANCE_SLOTS.length]
}

function hashPlayerId(playerId: string): number {
  let hash = 0
  for (let i = 0; i < playerId.length; i++) {
    hash = (hash * 31 + playerId.charCodeAt(i)) >>> 0
  }
  return hash
}

export function getDanceSlotForPlayer(playerId: string): Vector3 {
  const entry = gameState.matchPlayers.find(player => player.playerId === playerId)
  return DANCE_SLOTS[(entry?.slotIndex ?? 0) % DANCE_SLOTS.length]
}

function getAudienceSlotForPlayer(playerId: string): Vector3 {
  return AUDIENCE_SLOTS[hashPlayerId(playerId) % AUDIENCE_SLOTS.length]
}

function getLocalAudienceSlotPosition(): Vector3 {
  const player = getPlayer()
  const playerId = player?.userId || 'guest'
  const sessionSlotId = `${playerId}-${SESSION_AUDIENCE_ID}`
  if (localAudienceSlotIndex < 0 || localAudienceSlotPlayerId !== sessionSlotId) {
    localAudienceSlotPlayerId = sessionSlotId
    localAudienceSlotIndex = hashPlayerId(sessionSlotId) % AUDIENCE_SLOTS.length
  }

  const slot = AUDIENCE_SLOTS[localAudienceSlotIndex]
  const hash = hashPlayerId(`${sessionSlotId}-offset`)
  const offsetX = ((hash % 7) - 3) * 0.12
  const offsetZ = (((hash >>> 3) % 7) - 3) * 0.12
  return Vector3.create(slot.x + offsetX, slot.y, slot.z + offsetZ)
}

function isInsideDanceFloor(position: Vector3): boolean {
  return (
    position.x >= DANCE_FLOOR_MIN_X &&
    position.x <= DANCE_FLOOR_MAX_X &&
    position.z >= DANCE_FLOOR_MIN_Z &&
    position.z <= DANCE_FLOOR_MAX_Z
  )
}

function canLocalPlayerBeOnDanceFloor(): boolean {
  if (gameState.phase === 'gameover' && postGameReturnTimer > 0) return true
  return gameState.phase === 'playing' && (gameState.playMode === 'solo' || gameState.playMode === 'multiplayer')
}

function isDanceFloorRestricted(): boolean {
  return (
    gameState.phase === 'playing' ||
    (gameState.phase === 'gameover' && postGameReturnTimer > 0) ||
    remoteLiveMatchTimer > 0
  )
}

function getCameraFocusSlotPosition(): Vector3 {
  if (gameState.phase !== 'playing' && gameState.winnerCelebrationTimer > 0 && gameState.winnerPlayerId) {
    return getDanceSlotForPlayer(gameState.winnerPlayerId)
  }

  return getLocalDanceSlotPosition()
}

function getLocalCameraTargetPosition(): Vector3 {
  const slot = getCameraFocusSlotPosition()
  return Vector3.create(slot.x, 1.45, slot.z)
}

function getLocalCameraStartPosition(): Vector3 {
  const target = getLocalCameraTargetPosition()
  return Vector3.create(target.x, 2.7, target.z - 7.2)
}

function playHitBeatSound(): void {
  if (hitSoundEntity === engine.RootEntity) return

  const slot = getLocalDanceSlotPosition()
  Transform.createOrReplace(hitSoundEntity, {
    position: Vector3.create(slot.x, 1.2, slot.z),
  })
  AudioSource.playSound(hitSoundEntity, HIT_SOUND_URL, true)
}

function playArrowClapSound(): void {
  if (arrowClapSoundEntity === engine.RootEntity) return

  const slot = getLocalDanceSlotPosition()
  Transform.createOrReplace(arrowClapSoundEntity, {
    position: Vector3.create(slot.x, 1.2, slot.z),
  })
  AudioSource.playSound(arrowClapSoundEntity, ARROW_CLAP_SOUND_URL, true)
}

function playArrowFailSound(): void {
  if (arrowFailSoundEntity === engine.RootEntity) return

  const slot = getLocalDanceSlotPosition()
  Transform.createOrReplace(arrowFailSoundEntity, {
    position: Vector3.create(slot.x, 1.2, slot.z),
  })
  AudioSource.playSound(arrowFailSoundEntity, ARROW_FAIL_SOUND_URL, true)
}

function playMatchMusic(): void {
  if (matchMusicEntity === engine.RootEntity) return

  Transform.createOrReplace(matchMusicEntity, {
    position: Vector3.create(16, 2.2, 16),
  })
  AudioSource.createOrReplace(matchMusicEntity, {
    audioClipUrl: MATCH_MUSIC_URL,
    playing: true,
    volume: 0.72,
    loop: false,
    global: true,
  })
}

function stopMatchMusic(): void {
  if (matchMusicEntity === engine.RootEntity) return

  AudioSource.createOrReplace(matchMusicEntity, {
    audioClipUrl: MATCH_MUSIC_URL,
    playing: false,
    volume: 0.72,
    loop: false,
    global: true,
  })
}

function getLocalPlayerIdentity(): { playerId: string; name: string } {
  const player = getPlayer()
  return {
    playerId: player?.userId || 'local-player',
    name: player?.name || 'YOU',
  }
}

function assignMatchSlots(): void {
  const sortedForSlots = [...gameState.matchPlayers].sort((a, b) => {
    if (Number(b.ready) !== Number(a.ready)) return Number(b.ready) - Number(a.ready)
    if (b.rankPoints !== a.rankPoints) return b.rankPoints - a.rankPoints
    return a.playerId.localeCompare(b.playerId)
  })
  sortedForSlots.forEach((player, index) => {
    player.slotIndex = index % DANCE_SLOTS.length
  })
}

function sortMatchPlayers(): void {
  if (!matchSlotsLocked) assignMatchSlots()
  gameState.matchPlayers.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return b.maxCombo - a.maxCombo
  })
  gameState.matchWinnerName = gameState.matchPlayers[0]?.name || ''
}

function recordLeaderboardEntry(entry: MatchPlayer): void {
  const existing = gameState.globalLeaderboard.find(item => item.playerId === entry.playerId)
  if (!existing) {
    gameState.globalLeaderboard.push({ ...entry })
  } else {
    existing.name = entry.name
    existing.score = Math.max(existing.score, entry.score)
    existing.maxCombo = Math.max(existing.maxCombo, entry.maxCombo)
    existing.rankPoints = entry.rankPoints
    existing.wins = Math.max(existing.wins, entry.wins)
    existing.matchesPlayed = Math.max(existing.matchesPlayed, entry.matchesPlayed)
    existing.finished = entry.finished || existing.finished
    existing.slotIndex = entry.slotIndex
    existing.lastSeen = entry.lastSeen
  }

  gameState.globalLeaderboard.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    if (b.score !== a.score) return b.score - a.score
    if (b.rankPoints !== a.rankPoints) return b.rankPoints - a.rankPoints
    return b.maxCombo - a.maxCombo
  })
  gameState.globalLeaderboard = gameState.globalLeaderboard.slice(0, 10)
}

function getMatchWinner(): MatchPlayer | null {
  const participants = gameState.matchPlayers.filter(isActiveMatchPlayer)
  if (participants.length === 0) return null

  return participants.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.maxCombo !== a.maxCombo) return b.maxCombo - a.maxCombo
    if (b.rankPoints !== a.rankPoints) return b.rankPoints - a.rankPoints
    return a.playerId.localeCompare(b.playerId)
  })[0]
}

function startWinnerSpotlight(winner: MatchPlayer): void {
  if (winnerCelebrationStarted) return

  winnerCelebrationStarted = true
  gameState.matchWinnerName = winner.name
  gameState.winnerPlayerId = winner.playerId
  gameState.winnerCelebrationTimer = WINNER_CELEBRATION_DURATION
  hitCinematicTimer = 0

  const playerTransform = Transform.getOrNull(engine.PlayerEntity)
  if (playerTransform) {
    cinematicCameraPosition = Vector3.create(
      playerTransform.position.x,
      playerTransform.position.y + 1.8,
      playerTransform.position.z,
    )
  }

  setCinematicCameraActive(true)

  const local = getLocalPlayerIdentity()
  if (winner.playerId === local.playerId) {
    winner.wins += 1
    recordLeaderboardEntry(winner)
    saveProgress()
    playPredefinedEmote(WINNER_EMOTE)
    publishScore(true)
  } else {
    recordLeaderboardEntry(winner)
    playPredefinedEmote(LOSER_EMOTE)
  }
}

function tryStartWinnerSpotlight(): void {
  if (winnerCelebrationStarted) return
  const participants = gameState.matchPlayers.filter(isActiveMatchPlayer)
  if (participants.length === 0) return
  if (!participants.every(player => player.finished)) return

  const winner = getMatchWinner()
  if (winner) startWinnerSpotlight(winner)
}

function upsertMatchPlayer(
  playerId: string,
  name: string,
  score: number,
  maxCombo: number,
  rankPoints: number,
  wins: number,
  matchesPlayed: number,
  ready: boolean,
  finished: boolean,
  isLocal: boolean,
  phase: GameState['phase'] = 'idle',
  matchStartTime = 0,
  judgmentText: JudgmentText | '' = '',
  judgmentCombo = 0,
  judgmentSentAt = 0,
): MatchPlayer {
  let entry = gameState.matchPlayers.find(player => player.playerId === playerId)
  if (!entry) {
    entry = {
      playerId,
      name,
      score,
      maxCombo,
      rankPoints,
      wins,
      matchesPlayed,
      slotIndex: 0,
      finished,
      ready,
      phase,
      matchStartTime,
      judgmentText: '',
      judgmentCombo: 0,
      judgmentSentAt: 0,
      judgmentTimer: 0,
      isLocal,
      lastSeen: Date.now(),
    }
    gameState.matchPlayers.push(entry)
  }

  entry.name = name
  entry.score = score
  entry.maxCombo = maxCombo
  entry.rankPoints = rankPoints
  entry.wins = Math.max(entry.wins, wins)
  entry.matchesPlayed = Math.max(entry.matchesPlayed, matchesPlayed)
  entry.finished = phase === 'ready' || phase === 'idle' ? finished : finished || entry.finished
  entry.ready = ready
  entry.phase = phase
  entry.matchStartTime = matchStartTime
  if (judgmentSentAt > 0 && judgmentSentAt >= entry.judgmentSentAt) {
    entry.judgmentText = judgmentText
    entry.judgmentCombo = judgmentCombo
    entry.judgmentSentAt = judgmentSentAt
    entry.judgmentTimer = judgmentText ? 1.25 : 0
  }
  entry.isLocal = isLocal
  entry.lastSeen = Date.now()
  sortMatchPlayers()

  if (entry.finished) {
    recordLeaderboardEntry(entry)
  }

  return entry
}

function ensureLocalMatchPlayer(): MatchPlayer {
  const local = getLocalPlayerIdentity()
  let entry = gameState.matchPlayers.find(player => player.playerId === local.playerId)
  if (!entry) {
    entry = {
      playerId: local.playerId,
      name: local.name,
      score: 0,
      maxCombo: 0,
      rankPoints: gameState.rankPoints,
      wins: 0,
      matchesPlayed: 0,
      slotIndex: 0,
      finished: false,
      ready: false,
      phase: gameState.phase,
      matchStartTime: multiplayerMatchStartTimeMs,
      judgmentText: '',
      judgmentCombo: 0,
      judgmentSentAt: 0,
      judgmentTimer: 0,
      isLocal: true,
      lastSeen: Date.now(),
    }
    gameState.matchPlayers.push(entry)
  }
  entry.name = local.name
  entry.rankPoints = gameState.rankPoints
  entry.matchesPlayed = Math.max(0, entry.matchesPlayed)
  entry.phase = gameState.phase
  entry.matchStartTime = multiplayerMatchStartTimeMs
  entry.isLocal = true
  entry.lastSeen = Date.now()
  if (!matchSlotsLocked) assignMatchSlots()
  return entry
}

function updateLocalMatchPlayer(finished = false): void {
  const entry = ensureLocalMatchPlayer()
  entry.score = gameState.score
  entry.maxCombo = gameState.maxCombo
  entry.rankPoints = gameState.rankPoints
  entry.ready = gameState.playMode === 'multiplayer'
  entry.phase = gameState.phase
  entry.matchStartTime = multiplayerMatchStartTimeMs
  entry.finished = finished || entry.finished
  entry.lastSeen = Date.now()
  sortMatchPlayers()
}

function setLocalJudgment(text: JudgmentText, combo = 0): void {
  const entry = ensureLocalMatchPlayer()
  entry.judgmentText = text
  entry.judgmentCombo = combo
  entry.judgmentSentAt = Date.now()
  entry.judgmentTimer = 1.25
}

function prepareMultiplayerParticipants(): void {
  const local = ensureLocalMatchPlayer()
  local.ready = true
  local.phase = 'ready'
  local.matchStartTime = multiplayerMatchStartTimeMs
  local.rankPoints = gameState.rankPoints

  gameState.matchPlayers = getScheduledMatchParticipants()
  for (const player of gameState.matchPlayers) {
    player.score = 0
    player.maxCombo = 0
    player.finished = false
    player.phase = 'playing'
    player.matchStartTime = multiplayerMatchStartTimeMs
    player.judgmentText = ''
    player.judgmentCombo = 0
    player.judgmentSentAt = 0
    player.judgmentTimer = 0
    player.lastSeen = Date.now()
  }
  assignMatchSlots()
  sortMatchPlayers()
}

function publishScore(finished = false): void {
  if (gameState.playMode !== 'multiplayer') return

  const local = ensureLocalMatchPlayer()
  local.finished = finished || local.finished
  multiplayerBus.emit(MULTIPLAYER_SCORE_CHANNEL, {
    playerId: local.playerId,
    name: local.name,
    score: local.score,
    maxCombo: local.maxCombo,
    rankPoints: local.rankPoints,
    wins: local.wins,
    matchesPlayed: local.matchesPlayed,
    ready: local.ready,
    finished: local.finished,
    measureCount: gameState.measureCount,
    phase: gameState.phase,
    sentAt: Date.now(),
    matchStartTime: multiplayerMatchStartTimeMs,
    judgmentText: local.judgmentText,
    judgmentCombo: local.judgmentCombo,
    judgmentSentAt: local.judgmentSentAt,
  })
}

function initMultiplayerScoreBus(): void {
  ensureLocalMatchPlayer()
  multiplayerBus.on(MULTIPLAYER_SCORE_CHANNEL, (value: ScorePayload) => {
    if (gameState.playMode === 'solo') return
    if (!value || typeof value.playerId !== 'string') return

    const local = getLocalPlayerIdentity()
    if (value.playerId === local.playerId) return
    if (value.phase === 'playing' || value.phase === 'gameover') {
      remoteLiveMatchTimer = 3.5
      if (value.matchStartTime && value.matchStartTime > 0) {
        remoteLiveMatchStartTimeMs = value.matchStartTime
      }
    }
    if (value.matchStartTime && value.matchStartTime > 0) {
      const targetIsFuture = value.matchStartTime > Date.now()
      if (value.phase === 'ready' && gameState.phase === 'ready' && targetIsFuture) {
        if (multiplayerMatchStartTimeMs <= 0 || value.matchStartTime < multiplayerMatchStartTimeMs) {
          multiplayerMatchStartTimeMs = value.matchStartTime
          syncLocalReadyPlayerForScheduledMatch()
        }
      } else if (gameState.phase !== 'ready' && multiplayerMatchStartTimeMs <= 0) {
        multiplayerMatchStartTimeMs = value.matchStartTime
      }
    }

    upsertMatchPlayer(
      value.playerId,
      value.name || 'Dancer',
      Number(value.score) || 0,
      Number(value.maxCombo) || 0,
      Number(value.rankPoints) || 0,
      Number(value.wins) || 0,
      Number(value.matchesPlayed) || 0,
      Boolean(value.ready),
      Boolean(value.finished),
      false,
      value.phase,
      Number(value.matchStartTime) || 0,
      value.judgmentText || '',
      Number(value.judgmentCombo) || 0,
      Number(value.judgmentSentAt) || 0,
    )

    const localEntry = gameState.matchPlayers.find(player => player.playerId === local.playerId)
    if (
      gameState.phase === 'ready' &&
      gameState.playMode === 'multiplayer' &&
      localEntry?.ready &&
      value.phase === 'playing' &&
      isSameScheduledMatch(Number(value.matchStartTime) || 0) &&
      Date.now() >= multiplayerMatchStartTimeMs - MATCH_START_TOLERANCE_MS
    ) {
      startGame('multiplayer')
      return
    }

    tryStartWinnerSpotlight()
  })

  onEnterScene((player) => {
    if (gameState.playMode === 'solo') return

    const local = getLocalPlayerIdentity()
    if (player.userId === local.playerId) return
    upsertMatchPlayer(player.userId, player.name || 'Dancer', 0, 0, 0, 0, 0, false, false, false, 'idle', 0)
    publishScore(false)
  })

  onLeaveScene((userId) => {
    gameState.matchPlayers = gameState.matchPlayers.filter(player => player.playerId !== userId)
    sortMatchPlayers()
  })
}

function pruneInactiveMatchPlayers(): void {
  if (gameState.playMode === 'solo') {
    gameState.matchPlayers = []
    gameState.matchWinnerName = ''
    return
  }

  const local = getLocalPlayerIdentity()
  const now = Date.now()
  gameState.matchPlayers = gameState.matchPlayers.filter(player =>
    player.isLocal ||
    player.playerId === local.playerId ||
    now - player.lastSeen <= STALE_MATCH_PLAYER_MS,
  )
  sortMatchPlayers()
}

function refreshRank(): void {
  let rankIndex = 0
  for (let i = 0; i < DANCE_RANKS.length; i++) {
    if (gameState.rankPoints >= DANCE_RANKS[i].points) rankIndex = i
  }

  const current = DANCE_RANKS[rankIndex]
  const next = DANCE_RANKS[Math.min(rankIndex + 1, DANCE_RANKS.length - 1)]
  gameState.danceRank = current.name
  gameState.nextRankPoints = next.points
  gameState.rankProgress = next === current
    ? 1
    : Math.max(0, Math.min(1, (gameState.rankPoints - current.points) / (next.points - current.points)))
}

function getSaveKey(): string {
  return `${SAVE_KEY_PREFIX}:${getLocalPlayerIdentity().playerId}`
}

function readSavedProgress(): { rankPoints?: number; wins?: number; matchesPlayed?: number; dailySeed?: string; dailyGoals?: DailyGoal[] } | null {
  try {
    const storage = typeof localStorage === 'undefined' ? undefined : localStorage
    const raw = storage?.getItem(getSaveKey())
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveProgress(): void {
  try {
    const storage = typeof localStorage === 'undefined' ? undefined : localStorage
    if (!storage) return

    const local = gameState.matchPlayers.find(player => player.isLocal)
    storage.setItem(getSaveKey(), JSON.stringify({
      rankPoints: gameState.rankPoints,
      wins: local?.wins || 0,
      matchesPlayed: local?.matchesPlayed || 0,
      dailySeed: getDailySeed(),
      dailyGoals: gameState.dailyGoals,
    }))
  } catch {}
}

function loadProgress(): void {
  const saved = readSavedProgress()
  const today = getDailySeed()
  if (saved) {
    gameState.rankPoints = Math.max(0, Number(saved.rankPoints) || 0)
    if (saved.dailySeed === today && Array.isArray(saved.dailyGoals) && saved.dailyGoals.length > 0) {
      gameState.dailyGoals = saved.dailyGoals
    } else {
      gameState.dailyGoals = createDailyGoals(gameState.rankPoints, today)
    }
  } else {
    gameState.dailyGoals = createDailyGoals(gameState.rankPoints, today)
  }

  refreshRank()
  const local = ensureLocalMatchPlayer()
  local.rankPoints = gameState.rankPoints
  local.wins = Math.max(local.wins, Number(saved?.wins) || 0)
  local.matchesPlayed = Math.max(local.matchesPlayed, Number(saved?.matchesPlayed) || 0)
  saveProgress()
}

function awardRankPoints(points: number): void {
  gameState.rankPoints += points
  refreshRank()
  const local = ensureLocalMatchPlayer()
  local.rankPoints = gameState.rankPoints
  saveProgress()
}

function advanceDailyGoal(id: DailyGoal['id'], progress: number): void {
  const goal = gameState.dailyGoals.find(item => item.id === id)
  if (!goal || goal.completed) return

  goal.progress = Math.max(goal.progress, Math.min(goal.target, progress))
  if (goal.progress >= goal.target) {
    goal.completed = true
    awardRankPoints(goal.rewardRp)
  }
  saveProgress()
}

function awardPlacementRankPoints(): void {
  if (gameState.playMode !== 'multiplayer') return

  const entries = gameState.matchPlayers.filter(isActiveMatchPlayer).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.maxCombo !== a.maxCombo) return b.maxCombo - a.maxCombo
    return a.playerId.localeCompare(b.playerId)
  })
  const local = getLocalPlayerIdentity()
  const placement = entries.findIndex(player => player.playerId === local.playerId)
  if (placement < 0) return

  const rewards = [90, 65, 45, 30, 20]
  awardRankPoints(rewards[placement] ?? 10)
}

function recordGlobalLeaderboardScore(): void {
  const local = ensureLocalMatchPlayer()
  const scoreEntry: MatchPlayer = {
    ...local,
    score: gameState.score,
    maxCombo: gameState.maxCombo,
    finished: true,
    lastSeen: Date.now(),
  }
  recordLeaderboardEntry(scoreEntry)
}

function missSequence(): void {
  gameState.combo = 0
  gameState.misses++
  gameState.judgment = { text: 'MISS!', timer: 0.5, totalDuration: 0.5 }
  setLocalJudgment('MISS!')
  playComboFailEmote()
  updateLocalMatchPlayer()
  publishScore(false)
}

function finishGame(completedSong: boolean): void {
  if (completedSong && !gameState.runFinishedAwarded) {
    gameState.runFinishedAwarded = true
    advanceDailyGoal('finish_song', 1)
  }

  const local = ensureLocalMatchPlayer()
  if (!local.finished) local.matchesPlayed += 1
  if (gameState.playMode === 'multiplayer') {
    advanceDailyGoal('multiplayer_match', 1)
    awardPlacementRankPoints()
  }
  updateLocalMatchPlayer(true)
  saveProgress()
  publishScore(true)
  recordGlobalLeaderboardScore()
  tryStartWinnerSpotlight()
  if (gameState.playMode === 'solo') playPredefinedEmote(WINNER_EMOTE)
  stopMatchMusic()
  gameState.phase = 'gameover'
  gameState.lobbyPrompt = 'choice'
  postGameReturnTimer = POST_GAME_RESULT_DURATION
  setPlayerMovementLocked(true)
  setNativeTouchControlsHidden(false)
  if (gameState.winnerCelebrationTimer <= 0) setCinematicCameraActive(false)
}

function setPlayerMovementLocked(locked: boolean): void {
  if (locked === playerMovementLocked) return

  if (locked) {
    InputModifier.createOrReplace(engine.PlayerEntity, {
      mode: InputModifier.Mode.Standard({
        disableWalk: true,
        disableJog: true,
        disableRun: true,
        disableJump: true,
        disableDoubleJump: true,
        disableGliding: true,
      }),
    })
  } else if (InputModifier.has(engine.PlayerEntity)) {
    InputModifier.deleteFrom(engine.PlayerEntity)
  }

  playerMovementLocked = locked
}

function placePlayerOnDanceSpot(): void {
  if (!Transform.has(engine.PlayerEntity)) return

  const transform = Transform.getMutable(engine.PlayerEntity)
  const slotPosition = getLocalDanceSlotPosition()
  const dx = Math.abs(transform.position.x - slotPosition.x)
  const dy = Math.abs(transform.position.y - slotPosition.y)
  const dz = Math.abs(transform.position.z - slotPosition.z)

  if (dx > 0.03 || dy > 0.05 || dz > 0.03) {
    transform.position = Vector3.create(
      slotPosition.x,
      slotPosition.y,
      slotPosition.z,
    )
  }

  transform.rotation = FACE_GLOBAL_LEADERBOARD_ROTATION
}

function teleportPlayerToDanceSpot(): void {
  const slotPosition = getLocalDanceSlotPosition()
  const cameraTarget = Vector3.create(slotPosition.x, 1.5, slotPosition.z - 3.8)
  const avatarTarget = Vector3.create(slotPosition.x, 1.2, slotPosition.z - 5.5)

  void movePlayerTo({
    newRelativePosition: Vector3.create(slotPosition.x, slotPosition.y, slotPosition.z),
    cameraTarget,
    avatarTarget,
  }).then(() => {
    placePlayerOnDanceSpot()
  }).catch(() => {
    placePlayerOnDanceSpot()
  })
}

function placePlayerOnAudienceSpot(): void {
  if (!Transform.has(engine.PlayerEntity)) return

  const transform = Transform.getMutable(engine.PlayerEntity)
  const slotPosition = getLocalAudienceSlotPosition()
  transform.position = Vector3.create(slotPosition.x, slotPosition.y, slotPosition.z)
  transform.rotation = Quaternion.fromEulerDegrees(0, 180, 0)
}

function teleportPlayerToAudienceSpot(): void {
  const slotPosition = getLocalAudienceSlotPosition()

  void movePlayerTo({
    newRelativePosition: Vector3.create(slotPosition.x, slotPosition.y, slotPosition.z),
    cameraTarget: Vector3.create(16, 1.2, 16),
    avatarTarget: Vector3.create(16, 1.1, 20),
  }).catch(() => {
    placePlayerOnAudienceSpot()
  })
}

function keepNonPlayersOffDanceFloor(dt: number): void {
  audienceEnforceTimer = Math.max(0, audienceEnforceTimer - dt)
  remoteLiveMatchTimer = Math.max(0, remoteLiveMatchTimer - dt)
  syncMultiplayerLiveRemaining()
  if (audienceEnforceTimer > 0 || canLocalPlayerBeOnDanceFloor() || !isDanceFloorRestricted()) return

  const transform = Transform.getOrNull(engine.PlayerEntity)
  if (!transform || !isInsideDanceFloor(transform.position)) return

  audienceEnforceTimer = 0.75
  teleportPlayerToAudienceSpot()
}

function keepPlayerOnDanceSpot(): void {
  setPlayerMovementLocked(true)
  placePlayerOnDanceSpot()
}

function setNativeTouchControlsHidden(hidden: boolean): void {
  if (hidden === touchControlsHidden) return

  if (hidden) {
    TouchScreenControls.hideAll()
    TouchScreenControls.hideJoystick()
    TouchScreenControls.hideCrosshair()
  } else {
    TouchScreenControls.showAll()
    TouchScreenControls.showJoystick()
    TouchScreenControls.showCrosshair()
  }

  touchControlsHidden = hidden
}

function initCinematicCamera(): void {
  if (cinematicReady) return
  cinematicReady = true

  cinematicTargetEntity = engine.addEntity()
  Transform.create(cinematicTargetEntity, { position: getLocalCameraTargetPosition() })
  cinematicCameraPosition = getLocalCameraStartPosition()
  cinematicCameraFov = 58

  cinematicCameraEntity = engine.addEntity()
  Transform.create(cinematicCameraEntity, {
    position: cinematicCameraPosition,
    rotation: Quaternion.Identity(),
  })
  VirtualCamera.create(cinematicCameraEntity, {
    lookAtEntity: cinematicTargetEntity,
    fov: 58,
    defaultTransition: {
      transitionMode: VirtualCamera.Transition.Time(1.8),
    },
  })

  hitSoundEntity = engine.addEntity()
  Transform.create(hitSoundEntity, {
    position: Vector3.create(16, 1.2, 16),
  })
  AudioSource.create(hitSoundEntity, {
    audioClipUrl: HIT_SOUND_URL,
    playing: false,
    volume: 0.85,
    loop: false,
    global: false,
  })

  arrowClapSoundEntity = engine.addEntity()
  Transform.create(arrowClapSoundEntity, {
    position: Vector3.create(16, 1.2, 16),
  })
  AudioSource.create(arrowClapSoundEntity, {
    audioClipUrl: ARROW_CLAP_SOUND_URL,
    playing: false,
    volume: 1.0,
    loop: false,
    global: true,
  })

  arrowFailSoundEntity = engine.addEntity()
  Transform.create(arrowFailSoundEntity, {
    position: Vector3.create(16, 1.2, 16),
  })
  AudioSource.create(arrowFailSoundEntity, {
    audioClipUrl: ARROW_FAIL_SOUND_URL,
    playing: false,
    volume: 1.0,
    loop: false,
    global: true,
  })

  matchMusicEntity = engine.addEntity()
  Transform.create(matchMusicEntity, {
    position: Vector3.create(16, 2.2, 16),
  })
  AudioSource.create(matchMusicEntity, {
    audioClipUrl: MATCH_MUSIC_URL,
    playing: false,
    volume: 0.72,
    loop: false,
    global: true,
  })
}

function setCinematicCameraActive(active: boolean): void {
  if (active === cinematicCameraActive) return
  if (!cinematicReady) initCinematicCamera()

  MainCamera.getMutable(engine.CameraEntity).virtualCameraEntity = active ? cinematicCameraEntity : undefined
  cinematicCameraActive = active
}

function triggerHitCinematic(): void {
  hitCinematicTimer = HIT_CINEMATIC_DURATION
}

function updateCinematicCamera(dt: number): void {
  if (!cinematicReady) return

  cinematicTime += dt
  hitCinematicTimer = Math.max(0, hitCinematicTimer - dt)
  const cameraTarget = getLocalCameraTargetPosition()

  Transform.createOrReplace(cinematicTargetEntity, {
    position: Vector3.create(
      cameraTarget.x,
      cameraTarget.y + Math.sin(cinematicTime * 1.2) * 0.10,
      cameraTarget.z,
    ),
  })

  if (gameState.winnerCelebrationTimer > 0) {
    const drift = Math.sin(cinematicTime * 0.32)
    const targetX = cameraTarget.x + drift * 0.75
    const targetY = 2.35 + Math.sin(cinematicTime * 0.7) * 0.12
    const targetZ = cameraTarget.z - 4.6
    const cameraEase = 1 - Math.exp(-dt * 0.72)

    cinematicCameraPosition = Vector3.create(
      cinematicCameraPosition.x + (targetX - cinematicCameraPosition.x) * cameraEase,
      cinematicCameraPosition.y + (targetY - cinematicCameraPosition.y) * cameraEase,
      cinematicCameraPosition.z + (targetZ - cinematicCameraPosition.z) * cameraEase,
    )

    Transform.createOrReplace(cinematicCameraEntity, {
      position: cinematicCameraPosition,
      rotation: Quaternion.Identity(),
    })

    const camera = VirtualCamera.getMutable(cinematicCameraEntity)
    cinematicCameraFov += (35 - cinematicCameraFov) * cameraEase
    camera.fov = cinematicCameraFov
    return
  }

  const hitElapsed = HIT_CINEMATIC_DURATION - hitCinematicTimer
  const rise = Math.min(hitElapsed / HIT_CINEMATIC_APPROACH, 1)
  const fall = Math.min(hitCinematicTimer / HIT_CINEMATIC_RELEASE, 1)
  const hitEase = (rise * rise * (3 - 2 * rise)) * (fall * fall * (3 - 2 * fall))
  const drift = Math.sin(cinematicTime * 0.18)
  const normalHeight = 2.7 + Math.sin(cinematicTime * 0.9) * 0.35
  const height = normalHeight + (2.05 - normalHeight) * hitEase
  const normalX = cameraTarget.x + drift * 1.15
  const normalZ = cameraTarget.z - 7.2
  const closeX = cameraTarget.x + drift * 0.35
  const closeZ = cameraTarget.z - 3.35
  const targetX = normalX + (closeX - normalX) * hitEase
  const targetY = height
  const targetZ = normalZ + (closeZ - normalZ) * hitEase
  const cameraEase = 1 - Math.exp(-dt * (hitEase > 0 ? 0.95 : 0.5))

  cinematicCameraPosition = Vector3.create(
    cinematicCameraPosition.x + (targetX - cinematicCameraPosition.x) * cameraEase,
    cinematicCameraPosition.y + (targetY - cinematicCameraPosition.y) * cameraEase,
    cinematicCameraPosition.z + (targetZ - cinematicCameraPosition.z) * cameraEase,
  )

  Transform.createOrReplace(cinematicCameraEntity, {
    position: cinematicCameraPosition,
    rotation: Quaternion.Identity(),
  })

  const camera = VirtualCamera.getMutable(cinematicCameraEntity)
  const targetFov = 58 + (42 - 58) * hitEase
  cinematicCameraFov += (targetFov - cinematicCameraFov) * cameraEase
  camera.fov = cinematicCameraFov
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value += 0x6D2B79F5
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomIntFrom(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

export function getRoundModeLabel(mode: RoundMode): string {
  return MODE_LABELS[mode]
}

export function getSpaceWindow(): { start: number; end: number } {
  const halfWindow = Math.max(BAD_WINDOW / gameState.roundDuration, MIN_HIT_WINDOW_PROGRESS)
  return {
    start: Math.max(0, JUDGMENT_CENTER - halfWindow),
    end: Math.min(1, JUDGMENT_CENTER + halfWindow),
  }
}

function getRoundMode(measureCount: number): RoundMode {
  const progress = measureCount / TOTAL_MEASURES
  if (progress < 0.25) return 'easy'
  if (progress < 0.50) return 'middle'
  if (progress < 0.75) return 'freestyle'
  return 'hard'
}

function getSequenceLength(mode: RoundMode, rng = Math.random): number {
  if (mode === 'easy') return randomIntFrom(rng, 3, 4)
  if (mode === 'hard') return randomIntFrom(rng, 6, 8)
  return randomIntFrom(rng, 5, 8)
}

function getRoundDuration(mode: RoundMode): number {
  return ROUND_DURATIONS[mode]
}

function getComboWaitDuration(measureCount: number): number {
  return getBaseComboWaitDuration(measureCount)
}

function getMultiplayerTimeline(elapsedSeconds: number): {
  finished: boolean
  measureCount: number
  roundState: RoundState
  roundMode: RoundMode
  waitDuration: number
  waitTimer: number
  measureTime: number
  measureProgress: number
  beat: number
} {
  let cursor = 0

  for (let measure = 0; measure < TOTAL_MEASURES; measure++) {
    const waitDuration = getComboWaitDuration(measure)
    if (elapsedSeconds < cursor + waitDuration) {
      const mode = getRoundMode(measure)
      return {
        finished: false,
        measureCount: measure,
        roundState: 'waiting',
        roundMode: mode,
        waitDuration,
        waitTimer: Math.max(0, cursor + waitDuration - elapsedSeconds),
        measureTime: 0,
        measureProgress: 0,
        beat: Math.floor(elapsedSeconds / BEAT_DURATION),
      }
    }

    cursor += waitDuration
    const mode = getRoundMode(measure)
    const roundDuration = getRoundDuration(mode)
    if (elapsedSeconds < cursor + roundDuration) {
      const measureTime = elapsedSeconds - cursor
      return {
        finished: false,
        measureCount: measure,
        roundState: 'active',
        roundMode: mode,
        waitDuration: 0,
        waitTimer: 0,
        measureTime,
        measureProgress: Math.min(measureTime / roundDuration, 1),
        beat: Math.floor(elapsedSeconds / BEAT_DURATION),
      }
    }

    cursor += roundDuration
  }

  if (elapsedSeconds < MATCH_MUSIC_DURATION) {
    return {
      finished: false,
      measureCount: TOTAL_MEASURES,
      roundState: 'waiting',
      roundMode: 'hard',
      waitDuration: Math.max(0, MATCH_MUSIC_DURATION - cursor),
      waitTimer: Math.max(0, MATCH_MUSIC_DURATION - elapsedSeconds),
      measureTime: 0,
      measureProgress: 0,
      beat: Math.floor(elapsedSeconds / BEAT_DURATION),
    }
  }

  return {
    finished: true,
    measureCount: TOTAL_MEASURES,
    roundState: 'active',
    roundMode: 'hard',
    waitDuration: 0,
    waitTimer: 0,
    measureTime: getRoundDuration('hard'),
    measureProgress: 1,
    beat: Math.floor(elapsedSeconds / BEAT_DURATION),
  }
}

function makeStep(displayDirection: Direction, inverted: boolean): SequenceStep {
  return {
    displayDirection,
    inputDirection: inverted ? INVERTED_INPUT[displayDirection] : displayDirection,
    inverted,
  }
}

function generateSeq(mode: RoundMode, measureCount: number): SequenceStep[] {
  const modeSeed =
    mode === 'easy' ? 17 :
    mode === 'middle' ? 31 :
    mode === 'freestyle' ? 47 :
    67
  const rng = seededRandom(0xDABADA + measureCount * 101 + modeSeed)
  const len = getSequenceLength(mode, rng)
  const pool = mode === 'hard' ? HARD_DIRS : BASIC_DIRS
  const seq: SequenceStep[] = []

  for (let i = 0; i < len; i++) {
    let displayDirection: Direction
    do { displayDirection = pool[Math.floor(rng() * pool.length)] }
    while (
      seq.length >= 2 &&
      seq[seq.length - 1].inputDirection === displayDirection &&
      seq[seq.length - 2].inputDirection === displayDirection
    )

    const inverted = mode === 'freestyle' && rng() < 0.18
    seq.push(makeStep(displayDirection, inverted))
  }

  return seq
}

function startComboWait(duration = getComboWaitDuration(gameState.measureCount)): void {
  gameState.roundMode      = getRoundMode(gameState.measureCount)
  gameState.roundState     = 'waiting'
  gameState.waitDuration   = duration
  gameState.waitTimer      = gameState.waitDuration
  gameState.measureTime    = 0
  gameState.measureProgress = 0
  gameState.inputIndex     = 0
  gameState.sequenceFailed = false
  gameState.spacePressed   = false
  gameState.currentSequence = []
}

function newMeasure(): void {
  const mode = getRoundMode(gameState.measureCount)
  gameState.roundMode       = mode
  gameState.roundDuration   = getRoundDuration(mode)
  gameState.roundState      = 'active'
  gameState.waitTimer       = 0
  gameState.waitDuration    = 0
  gameState.measureTime     = 0
  gameState.measureProgress = 0
  gameState.inputIndex      = 0
  gameState.sequenceFailed  = false
  gameState.spacePressed    = false
  gameState.currentSequence = generateSeq(mode, gameState.measureCount)
}

function syncMultiplayerTimeline(): boolean {
  if (gameState.playMode !== 'multiplayer' || multiplayerMatchStartTimeMs <= 0) return false

  const elapsed = Math.max(0, (Date.now() - multiplayerMatchStartTimeMs) / 1000)
  const frame = getMultiplayerTimeline(elapsed)

  if (frame.finished) {
    if (syncedMultiplayerState === 'active' && !gameState.spacePressed) missSequence()
    if (gameState.phase === 'playing') finishGame(true)
    return true
  }

  const changedMeasure = frame.measureCount !== syncedMultiplayerMeasure
  const changedState = frame.roundState !== syncedMultiplayerState
  if (changedMeasure || changedState) {
    if (syncedMultiplayerState === 'active' && !gameState.spacePressed) missSequence()
    gameState.inputIndex = 0
    gameState.sequenceFailed = false
    gameState.spacePressed = false
    gameState.spaceFlash = 0
    gameState.currentSequence = frame.roundState === 'active'
      ? generateSeq(frame.roundMode, frame.measureCount)
      : []
    syncedMultiplayerMeasure = frame.measureCount
    syncedMultiplayerState = frame.roundState
  }

  gameState.measureCount = frame.measureCount
  gameState.roundMode = frame.roundMode
  gameState.roundDuration = getRoundDuration(frame.roundMode)
  gameState.roundState = frame.roundState
  gameState.waitDuration = frame.waitDuration
  gameState.waitTimer = frame.waitTimer
  gameState.measureTime = frame.measureTime
  gameState.measureProgress = frame.measureProgress

  if (frame.beat !== gameState.currentBeat) {
    gameState.currentBeat = frame.beat
    gameState.beatPulse = 1.0
  }

  return false
}

// ──────────────────────────────────────────────────────────
// Public: lobby / start / restart
// ──────────────────────────────────────────────────────────
function startGame(mode: Exclude<PlayMode, 'none'>): void {
  gameState.playMode = mode
  gameState.lobbyPrompt = 'hidden'
  postGameReturnTimer = 0
  syncedMultiplayerMeasure = -1
  syncedMultiplayerState = null
  if (mode === 'solo') {
    matchSlotsLocked = false
    multiplayerMatchStartTimeMs = 0
    gameState.matchPlayers = []
    gameState.matchWinnerName = ''
  } else {
    if (multiplayerMatchStartTimeMs <= 0) multiplayerMatchStartTimeMs = Date.now()
    prepareMultiplayerParticipants()
    matchSlotsLocked = true
  }

  setPlayerMovementLocked(true)
  teleportPlayerToDanceSpot()
  placePlayerOnDanceSpot()
  gameState.phase        = 'playing'
  gameState.roundState   = 'active'
  gameState.roundMode    = 'easy'
  gameState.waitTimer    = 0
  gameState.waitDuration = 0
  gameState.roundDuration = getRoundDuration('easy')
  gameState.score        = 0
  gameState.combo        = 0
  gameState.maxCombo     = 0
  gameState.perfectHits  = 0
  gameState.greatHits    = 0
  gameState.coolHits     = 0
  gameState.badHits      = 0
  gameState.misses       = 0
  gameState.measureCount = 0
  gameState.runFinishedAwarded = false
  gameState.judgment     = null
  gameState.keyFlash     = { left: 0, down: 0, up: 0, right: 0, upLeft: 0, upRight: 0 }
  gameState.spaceFlash   = 0
  gameState.winnerPlayerId = ''
  gameState.winnerCelebrationTimer = 0
  winnerCelebrationStarted = false
  gameState.multiplayerCountdown = 0
  localMatchElapsed = 0
  totalBeats             = 0
  updateLocalMatchPlayer(false)
  publishScore(false)
  playMatchMusic()
  startComboWait()
}

export function startSoloMode(): void {
  startGame('solo')
}

export function readyForMultiplayer(): void {
  matchSlotsLocked = false
  postGameReturnTimer = 0
  const liveRemaining = syncMultiplayerLiveRemaining()
  multiplayerMatchStartTimeMs = liveRemaining > 0
    ? (remoteLiveMatchStartTimeMs > 0
      ? remoteLiveMatchStartTimeMs + getMultiplayerMatchDuration() * 1000
      : Date.now() + liveRemaining * 1000)
    : getNextMultiplayerMatchStartMs()
  syncedMultiplayerMeasure = -1
  syncedMultiplayerState = null
  gameState.playMode = 'multiplayer'
  gameState.lobbyPrompt = 'hidden'
  gameState.phase = 'ready'
  gameState.roundState = 'waiting'
  const remaining = syncGlobalMultiplayerWindow()
  const local = ensureLocalMatchPlayer()
  local.ready = false
  local.phase = 'ready'
  local.matchStartTime = multiplayerMatchStartTimeMs
  local.rankPoints = gameState.rankPoints
  local.score = 0
  local.maxCombo = 0
  local.finished = false
  sortMatchPlayers()
  gameState.waitTimer = remaining
  gameState.waitDuration = Math.max(remaining, 1)
  gameState.multiplayerCountdown = remaining
  lastReadyWindowRemaining = remaining
  setPlayerMovementLocked(false)
  setNativeTouchControlsHidden(false)
  setCinematicCameraActive(false)
  publishScore(false)
}

export function cancelMultiplayerReady(): void {
  const local = ensureLocalMatchPlayer()
  local.ready = false
  local.finished = false
  gameState.phase = 'idle'
  local.phase = 'idle'
  multiplayerMatchStartTimeMs = 0
  local.matchStartTime = 0
  publishScore(false)
  gameState.playMode = 'none'
  gameState.lobbyPrompt = 'play'
  gameState.roundState = 'waiting'
  gameState.waitTimer = 0
  gameState.waitDuration = 0
  gameState.multiplayerCountdown = 0
  matchSlotsLocked = false
  postGameReturnTimer = 0
  syncedMultiplayerMeasure = -1
  syncedMultiplayerState = null
  resetMultiplayerReadyWindow()
  setPlayerMovementLocked(false)
  setNativeTouchControlsHidden(false)
  setCinematicCameraActive(false)
  teleportPlayerToAudienceSpot()
  stopMatchMusic()
  publishScore(false)
}

export function toggleMultiplayerReady(): void {
  if (gameState.phase !== 'ready' || gameState.playMode !== 'multiplayer') return

  const local = ensureLocalMatchPlayer()
  local.ready = !local.ready
  local.phase = 'ready'
  local.matchStartTime = multiplayerMatchStartTimeMs
  local.finished = false
  local.score = 0
  local.maxCombo = 0
  sortMatchPlayers()
  publishScore(false)
}

export function returnToLobby(): void {
  const local = ensureLocalMatchPlayer()
  local.ready = false
  local.finished = false
  gameState.phase = 'idle'
  local.phase = 'idle'
  multiplayerMatchStartTimeMs = 0
  local.matchStartTime = 0
  publishScore(false)
  gameState.playMode = 'none'
  gameState.lobbyPrompt = 'choice'
  gameState.roundState = 'active'
  gameState.waitTimer = 0
  gameState.waitDuration = 0
  gameState.winnerPlayerId = ''
  gameState.winnerCelebrationTimer = 0
  winnerCelebrationStarted = false
  matchSlotsLocked = false
  postGameReturnTimer = 0
  multiplayerMatchStartTimeMs = 0
  syncedMultiplayerMeasure = -1
  syncedMultiplayerState = null
  gameState.multiplayerCountdown = 0
  resetMultiplayerReadyWindow()
  setPlayerMovementLocked(false)
  setNativeTouchControlsHidden(false)
  setCinematicCameraActive(false)
  teleportPlayerToAudienceSpot()
  stopMatchMusic()
  publishScore(false)
}

export function watchLiveMode(): void {
  const local = ensureLocalMatchPlayer()
  local.ready = false
  local.finished = false
  gameState.phase = 'idle'
  local.phase = 'idle'
  multiplayerMatchStartTimeMs = 0
  local.matchStartTime = 0
  publishScore(false)
  gameState.playMode = 'none'
  gameState.lobbyPrompt = 'hidden'
  matchSlotsLocked = false
  postGameReturnTimer = 0
  multiplayerMatchStartTimeMs = 0
  syncedMultiplayerMeasure = -1
  syncedMultiplayerState = null
  resetMultiplayerReadyWindow()
  setPlayerMovementLocked(false)
  setNativeTouchControlsHidden(false)
  setCinematicCameraActive(false)
  teleportPlayerToAudienceSpot()
  stopMatchMusic()
  publishScore(false)
}

export function openPlayMenu(): void {
  const local = ensureLocalMatchPlayer()
  local.ready = false
  local.finished = false
  gameState.phase = 'idle'
  local.phase = 'idle'
  multiplayerMatchStartTimeMs = 0
  local.matchStartTime = 0
  publishScore(false)
  gameState.playMode = 'none'
  gameState.lobbyPrompt = 'play'
  matchSlotsLocked = false
  postGameReturnTimer = 0
  multiplayerMatchStartTimeMs = 0
  syncedMultiplayerMeasure = -1
  syncedMultiplayerState = null
  resetMultiplayerReadyWindow()
  setPlayerMovementLocked(false)
  setNativeTouchControlsHidden(false)
  setCinematicCameraActive(false)
  teleportPlayerToAudienceSpot()
  stopMatchMusic()
  publishScore(false)
}

// ──────────────────────────────────────────────────────────
// Input handlers
// ──────────────────────────────────────────────────────────
function handleArrow(dir: Direction): void {
  if (gameState.phase !== 'playing') return
  if (gameState.roundState !== 'active') return
  if (gameState.spacePressed)   return  // measure already locked
  if (gameState.sequenceFailed) return  // already broken
  // Arrow input is only accepted before the judgment zone
  if (gameState.measureProgress > JUDGMENT_CENTER) return

  if (dir === gameState.currentSequence[gameState.inputIndex]?.inputDirection) {
    playArrowClapSound()
    gameState.inputIndex++
  } else {
    playArrowFailSound()
    gameState.inputIndex = 0
  }
}

function handleSpace(): void {
  if (gameState.phase !== 'playing') return
  if (gameState.roundState !== 'active') return
  if (gameState.spacePressed) return
  // HIT is only consumed once while the beat marker is inside the judgment zone.
  const spaceWindow = getSpaceWindow()
  if (gameState.measureProgress < spaceWindow.start || gameState.measureProgress > spaceWindow.end) return

  gameState.spacePressed = true
  gameState.spaceFlash   = 1.0

  // Sequence must be fully and correctly typed
  const complete =
    !gameState.sequenceFailed &&
    gameState.inputIndex >= gameState.currentSequence.length

  if (!complete) {
    missSequence()
    return
  }

  // Calculate timing precision
  const diff = Math.abs(gameState.measureProgress - JUDGMENT_CENTER) * gameState.roundDuration

  let text: JudgmentText
  let pts: number

  if (diff <= PERFECT_WINDOW) {
    text = 'PERFECT!'; pts = 1000
  } else if (diff <= GREAT_WINDOW) {
    text = 'GREAT!';   pts = 700
  } else if (diff <= COOL_WINDOW) {
    text = 'COOL!';    pts = 400
  } else if (diff <= BAD_WINDOW) {
    text = 'BAD!';     pts = 100
  } else {
    text = 'BAD!';     pts = 100
  }

  pts = Math.round(pts * MODE_SCORE_MULTIPLIER[gameState.roundMode])

  if (text === 'PERFECT!') {
    gameState.combo++
    gameState.maxCombo = Math.max(gameState.maxCombo, gameState.combo)
    gameState.score += pts * Math.min(gameState.combo, 10)
    gameState.perfectHits++
    advanceDailyGoal('perfect_hits', gameState.perfectHits)
    advanceDailyGoal('perfect_combo', gameState.maxCombo)
    playComboSuccessEmote(gameState.combo)
  } else {
    gameState.combo = 0
    gameState.score += pts

    if (text === 'GREAT!') {
      gameState.greatHits++
      advanceDailyGoal('great_hits', gameState.perfectHits + gameState.greatHits)
      playGoodDanceEmote(gameState.greatHits)
    } else if (text === 'COOL!') {
      gameState.coolHits++
      advanceDailyGoal('cool_hits', gameState.perfectHits + gameState.greatHits + gameState.coolHits)
      playGoodDanceEmote(gameState.coolHits + 1)
    } else if (text === 'BAD!') {
      gameState.badHits++
      playGoodDanceEmote(gameState.combo)
    }
  }
  advanceDailyGoal('score_total', gameState.score)

  playHitBeatSound()
  triggerHitCinematic()

  const dur = text === 'PERFECT!' ? 1.0 : 0.6
  gameState.judgment = { text, timer: dur, totalDuration: dur }
  setLocalJudgment(text, text === 'PERFECT!' ? gameState.combo : 0)
  updateLocalMatchPlayer()
  publishScore(false)
}

// ──────────────────────────────────────────────────────────
// Main game system
// ──────────────────────────────────────────────────────────
export function initGame(): void {
  initMultiplayerScoreBus()
  ensureLocalMatchPlayer()
  loadProgress()
  resetMultiplayerReadyWindow()
  initCinematicCamera()
  teleportPlayerToAudienceSpot()

  engine.addSystem((dt: number) => {
    // ── Decay visual feedback ──
    gameState.beatPulse  = Math.max(0, gameState.beatPulse  - dt * 6)
    gameState.spaceFlash = Math.max(0, gameState.spaceFlash - dt * 4)
    for (const d of ALL_DIRS) {
      gameState.keyFlash[d] = Math.max(0, gameState.keyFlash[d] - dt * 8)
    }
    if (gameState.judgment) {
      gameState.judgment.timer -= dt
      if (gameState.judgment.timer <= 0) gameState.judgment = null
    }
    for (const player of gameState.matchPlayers) {
      player.judgmentTimer = Math.max(0, player.judgmentTimer - dt)
    }
    pruneInactiveMatchPlayers()
    tickLobbyMatchWindow()
    keepNonPlayersOffDanceFloor(dt)

    if (gameState.phase === 'gameover' && postGameReturnTimer > 0) {
      postGameReturnTimer = Math.max(0, postGameReturnTimer - dt)
      if (postGameReturnTimer <= 0) {
        returnToLobby()
        return
      }
    }

    if (gameState.winnerCelebrationTimer > 0) {
      gameState.winnerCelebrationTimer = Math.max(0, gameState.winnerCelebrationTimer - dt)
      setCinematicCameraActive(true)
      updateCinematicCamera(dt)
      if (gameState.phase !== 'playing') {
        setPlayerMovementLocked(gameState.phase === 'gameover')
        setNativeTouchControlsHidden(false)
        if (gameState.winnerCelebrationTimer <= 0) setCinematicCameraActive(false)
        return
      }
    }

    if (gameState.phase === 'ready') {
      tickMultiplayerReadyWindow()
      setPlayerMovementLocked(false)
      setNativeTouchControlsHidden(false)
      setCinematicCameraActive(false)
      multiplayerSyncTimer += dt
      if (multiplayerSyncTimer >= MULTIPLAYER_SYNC_INTERVAL) {
        multiplayerSyncTimer = 0
        publishScore(false)
      }
      return
    }

    if (gameState.phase !== 'playing') {
      setPlayerMovementLocked(gameState.phase === 'gameover')
      setNativeTouchControlsHidden(false)
      setCinematicCameraActive(false)
      multiplayerSyncTimer = 0
      return
    }

    keepPlayerOnDanceSpot()
    localMatchElapsed += dt
    setNativeTouchControlsHidden(true)
    setCinematicCameraActive(true)
    updateCinematicCamera(dt)
    updateLocalMatchPlayer()
    multiplayerSyncTimer += dt
    if (multiplayerSyncTimer >= MULTIPLAYER_SYNC_INTERVAL) {
      multiplayerSyncTimer = 0
      publishScore(false)
    }

    if (gameState.playMode === 'multiplayer') {
      if (syncMultiplayerTimeline()) return
    }

    // ── Breath between combos ──
    if (gameState.roundState === 'waiting') {
      if (gameState.playMode === 'solo') {
        gameState.waitTimer = Math.max(0, gameState.waitTimer - dt)
      if (gameState.waitTimer <= 0) {
          if (gameState.measureCount >= TOTAL_MEASURES) finishGame(true)
          else newMeasure()
        }
      }
      return
    }

    // ── Advance measure time before reading inputs so the hit window matches the rendered marker.
    if (gameState.playMode === 'solo') {
      gameState.measureTime    += dt
      gameState.measureProgress = Math.min(gameState.measureTime / gameState.roundDuration, 1.0)

      const beatIdx = Math.floor(gameState.measureTime / BEAT_DURATION) + totalBeats
      if (beatIdx !== gameState.currentBeat) {
        gameState.currentBeat = beatIdx
        gameState.beatPulse   = 1.0
      }
    }

    // ── Arrow inputs (WASD / directional) ──
    const mobileInput = isMobile()

    if (
      inputSystem.isTriggered(InputAction.IA_LEFT, PointerEventType.PET_DOWN) ||
      (mobileInput && inputSystem.isTriggered(InputAction.IA_ACTION_3, PointerEventType.PET_DOWN))
    ) {
      gameState.keyFlash.left = 1.0
      handleArrow('left')
    }
    if (
      inputSystem.isTriggered(InputAction.IA_RIGHT, PointerEventType.PET_DOWN) ||
      (mobileInput && inputSystem.isTriggered(InputAction.IA_ACTION_4, PointerEventType.PET_DOWN))
    ) {
      gameState.keyFlash.right = 1.0
      handleArrow('right')
    }
    if (
      inputSystem.isTriggered(InputAction.IA_FORWARD, PointerEventType.PET_DOWN) ||
      (mobileInput && inputSystem.isTriggered(InputAction.IA_ACTION_5, PointerEventType.PET_DOWN))
    ) {
      gameState.keyFlash.up = 1.0
      handleArrow('up')
    }
    if (
      inputSystem.isTriggered(InputAction.IA_BACKWARD, PointerEventType.PET_DOWN) ||
      (mobileInput && inputSystem.isTriggered(InputAction.IA_ACTION_6, PointerEventType.PET_DOWN))
    ) {
      gameState.keyFlash.down = 1.0
      handleArrow('down')
    }
    if (
      (!mobileInput && inputSystem.isTriggered(InputAction.IA_ACTION_3, PointerEventType.PET_DOWN)) ||
      inputSystem.isTriggered(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN)
    ) {
      gameState.keyFlash.upLeft = 1.0
      handleArrow('upLeft')
    }
    if (
      inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN) ||
      (!mobileInput && inputSystem.isTriggered(InputAction.IA_ACTION_4, PointerEventType.PET_DOWN))
    ) {
      gameState.keyFlash.upRight = 1.0
      handleArrow('upRight')
    }

    // ── Spacebar = timing judgment ──
    if (inputSystem.isTriggered(InputAction.IA_JUMP, PointerEventType.PET_DOWN)) {
      handleSpace()
    }

    placePlayerOnDanceSpot()

    // ── Auto-miss if measure ends without Space ──
    if (gameState.measureProgress >= 1.0 && !gameState.spacePressed) {
      missSequence()
    }

    if (gameState.playMode === 'multiplayer') return

    // ── Advance to next measure ──
    if (gameState.measureProgress >= 1.0) {
      gameState.measureCount++
      if (gameState.measureCount >= TOTAL_MEASURES) {
        const remainingMusic = Math.max(0, MATCH_MUSIC_DURATION - localMatchElapsed)
        if (remainingMusic > 0.05) startComboWait(remainingMusic)
        else finishGame(true)
      } else {
        totalBeats += Math.ceil(gameState.roundDuration / BEAT_DURATION)
        startComboWait()
      }
    }
  })
}
