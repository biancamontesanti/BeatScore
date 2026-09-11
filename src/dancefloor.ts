import {
  engine,
  Entity,
  Transform,
  MeshRenderer,
  MeshCollider,
  Material,
  TextShape,
  VisibilityComponent,
} from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import { gameState, getDanceSlotForPlayer, type JudgmentText, type MatchPlayer } from './game'

// ──────────────────────────────────────────────────────────
// Scene constants  — 2×2 parcel = 32×32 m, centre at (16,0,16)
// ──────────────────────────────────────────────────────────
const CX = 16   // scene centre X
const CZ = 16   // scene centre Z

// Main dance floor: 16×16 tiles, 1 m each
const FLOOR_TILE   = 16
const TILE_SIZE    = 1.0
const FLOOR_OX     = CX - FLOOR_TILE / 2   //  8
const FLOOR_OZ     = CZ - FLOOR_TILE / 2   //  8

// ──────────────────────────────────────────────────────────
// Tile state
// ──────────────────────────────────────────────────────────
interface Tile { entity: Entity; baseColor: Color4; x: number; z: number }
const tiles: Tile[] = []

interface TileFlash {
  entity:     Entity
  baseColor:  Color4
  flashColor: Color4
  timer:      number
  duration:   number
  intensity:  number
}
const activeFlashes: TileFlash[] = []

// ──────────────────────────────────────────────────────────
// Disco-ball rotation
// ──────────────────────────────────────────────────────────
const discoBalls: Entity[] = []
let discoBallAngle = 0

interface LeaderboardRow {
  avatar: Entity
  placeBadge: Entity
  placeText: Entity
  nameText: Entity
  rankBadgeText: Entity
  rpText: Entity
  scoreText: Entity
  winsText: Entity
}
const leaderboardRows: LeaderboardRow[] = []

interface GlobalRecordRow {
  avatar: Entity
  nameText: Entity
  rankBadgeText: Entity
  rpText: Entity
  perfectText: Entity
  playedText: Entity
}
const globalRecordRows: GlobalRecordRow[] = []
const currentDanceEntities: Entity[] = []
const winnerHighlightEntities: Entity[] = []
const playerJudgmentTexts = new Map<string, Entity>()
let currentDanceTitleEntity: Entity | null = null
let winnerHighlightAvatar: Entity | null = null
let winnerHighlightNameText: Entity | null = null
let winnerHighlightRankText: Entity | null = null
let winnerHighlightScoreText: Entity | null = null
let lastDancePhase = gameState.phase
let winnerHighlightTimer = 0
let leaderboardTimer = 0
let winnerCelebrationWasActive = false
let currentDancePage = 0
let currentDancePageTimer = 0
let lastDanceEntries: MatchPlayer[] = []
const WINNER_HIGHLIGHT_SECONDS = 7.0
const CURRENT_DANCE_PAGE_SECONDS = 3.0
const REACTIVE_FLOOR_INTERVAL = 0.12
const REACTIVE_FLOOR_MOVE_DISTANCE = 0.34
const REACTIVE_FLOOR_RADIUS = 0.92
let reactiveFloorTimer = 0
let lastReactiveX = Number.NaN
let lastReactiveZ = Number.NaN

// ──────────────────────────────────────────────────────────
// Colours
// ──────────────────────────────────────────────────────────
const TILE_BASE: Color4[] = [
  Color4.create(0.06, 0.04, 0.18, 1),
  Color4.create(0.08, 0.03, 0.22, 1),
  Color4.create(0.04, 0.06, 0.20, 1),
]

const FLASH_POOL: Color4[] = [
  Color4.create(1.0, 0.3, 0.7,  1),
  Color4.create(0.3, 0.6, 1.0,  1),
  Color4.create(0.4, 1.0, 0.5,  1),
  Color4.create(1.0, 0.9, 0.2,  1),
  Color4.create(1.0, 0.4, 0.1,  1),
  Color4.create(0.8, 0.2, 1.0,  1),
]

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────
function pbr(
  entity: Entity,
  albedo: Color4,
  emissive: Color3,
  emissiveIntensity: number,
  metallic = 0.85,
  roughness = 0.15,
): void {
  Material.setPbrMaterial(entity, { albedoColor: albedo, emissiveColor: emissive, emissiveIntensity, metallic, roughness })
}

function box(entity: Entity, x: number, y: number, z: number, sx: number, sy: number, sz: number): void {
  Transform.create(entity, {
    position: Vector3.create(x, y, z),
    scale:    Vector3.create(sx, sy, sz),
  })
  MeshRenderer.setBox(entity)
  MeshCollider.setBox(entity)
}

function setEntityGroupVisible(entities: Entity[], visible: boolean): void {
  for (const entity of entities) {
    VisibilityComponent.createOrReplace(entity, { visible, propagateToChildren: true })
  }
}

function remember(entity: Entity, collection: Entity[]): Entity {
  collection.push(entity)
  return entity
}

function textEntity(text: string, x: number, y: number, z: number, fontSize: number, color: Color4, scale = 0.35, rotationY = 180): Entity {
  const entity = engine.addEntity()
  Transform.create(entity, {
    position: Vector3.create(x, y, z),
    rotation: Quaternion.fromEulerDegrees(0, rotationY, 0),
    scale: Vector3.create(scale, scale, scale),
  })
  TextShape.create(entity, {
    text,
    fontSize,
    textColor: color,
    outlineWidth: 0.08,
    outlineColor: Color3.create(0, 0, 0),
  })
  return entity
}

function beatScoreLogoEntity(x: number, y: number, z: number, width: number, height: number, rotationY = 180): Entity {
  const entity = engine.addEntity()
  const logoTexture = Material.Texture.Common({ src: 'assets/images/beatscore.png' })
  Transform.create(entity, {
    position: Vector3.create(x, y, z),
    rotation: Quaternion.fromEulerDegrees(0, rotationY, 0),
    scale: Vector3.create(width, height, 1),
  })
  MeshRenderer.setPlane(entity)
  Material.setBasicMaterial(entity, {
    texture: logoTexture,
    alphaTexture: logoTexture,
    alphaTest: 0.08,
    castShadows: false,
    diffuseColor: Color4.White(),
  })
  return entity
}

function glassRoundedSign(x: number, y: number, z: number, width: number, height: number, showCorners = true): void {
  const panel = engine.addEntity()
  box(panel, x, y, z, width, height, 0.10)
  pbr(panel,
    Color4.create(0.95, 0.55, 1.0, 0.22),
    Color3.create(0.95, 0.20, 0.75),
    0.85, 0.05, 0.08,
  )

  if (!showCorners) return

  const cornerPositions: [number, number][] = [
    [x - width / 2, y - height / 2],
    [x + width / 2, y - height / 2],
    [x - width / 2, y + height / 2],
    [x + width / 2, y + height / 2],
  ]

  for (const [cx, cy] of cornerPositions) {
    const corner = engine.addEntity()
    Transform.create(corner, {
      position: Vector3.create(cx, cy, z + 0.03),
      scale: Vector3.create(0.42, 0.42, 0.08),
    })
    MeshRenderer.setSphere(corner)
    pbr(corner,
      Color4.create(1.0, 0.35, 0.88, 0.34),
      Color3.create(1.0, 0.20, 0.78),
      1.2, 0.05, 0.06,
    )
  }
}

function placementLabel(index: number): string {
  return index === 0 ? '1ST' :
    index === 1 ? '2ND' :
    index === 2 ? '3RD' :
    `${index + 1}TH`
}

function placementColor(index: number): Color4 {
  if (index === 0) return Color4.create(1.0, 0.72, 0.10, 0.96)
  if (index === 1) return Color4.create(0.74, 0.78, 0.90, 0.94)
  if (index === 2) return Color4.create(0.84, 0.46, 0.18, 0.94)
  return Color4.create(0.30, 0.16, 0.52, 0.92)
}

function danceRankFromPoints(points: number): string {
  if (points >= 900) return 'Royalty'
  if (points >= 500) return 'Spotlight'
  if (points >= 250) return 'Regular'
  if (points >= 100) return 'Apprentice'
  return 'Rookie'
}

function judgmentColor(text: JudgmentText | ''): Color4 {
  if (text === 'PERFECT!') return Color4.create(0.25, 0.85, 1.0, 1)
  if (text === 'GREAT!') return Color4.create(0.4, 1.0, 0.55, 1)
  if (text === 'COOL!') return Color4.create(0.75, 0.35, 1.0, 1)
  if (text === 'BAD!') return Color4.create(1.0, 0.55, 0.15, 1)
  return Color4.create(1.0, 0.30, 0.30, 1)
}

function getPlayerJudgmentText(player: MatchPlayer): Entity {
  let entity = playerJudgmentTexts.get(player.playerId)
  if (!entity) {
    entity = textEntity('', 16, 1.65, 16, 6, judgmentColor('MISS!'), 0.32, 0)
    VisibilityComponent.createOrReplace(entity, { visible: false })
    playerJudgmentTexts.set(player.playerId, entity)
  }
  return entity
}

function updatePlayerJudgmentTexts(): void {
  const activeIds = new Set<string>()
  const visiblePhase = gameState.phase === 'playing' && gameState.playMode === 'multiplayer'

  for (const player of gameState.matchPlayers) {
    activeIds.add(player.playerId)
    const entity = getPlayerJudgmentText(player)
    const visible = visiblePhase && player.ready && player.phase === 'playing' && player.judgmentTimer > 0 && !!player.judgmentText
    VisibilityComponent.createOrReplace(entity, { visible, propagateToChildren: true })
    if (!visible) continue

    const slot = getDanceSlotForPlayer(player.playerId)
    const transform = Transform.getMutable(entity)
    transform.position = Vector3.create(slot.x, 1.62, slot.z - 0.36)
    transform.rotation = Quaternion.fromEulerDegrees(0, 0, 0)
    transform.scale = Vector3.create(0.32, 0.32, 0.32)

    const shape = TextShape.getMutable(entity)
    shape.text = player.judgmentText === 'PERFECT!' && player.judgmentCombo > 1
      ? `PERFECT! ${player.judgmentCombo}x`
      : player.judgmentText
    shape.textColor = judgmentColor(player.judgmentText)
    shape.fontSize = player.judgmentText === 'PERFECT!' ? 5 : 5
  }

  for (const [playerId, entity] of playerJudgmentTexts) {
    if (!activeIds.has(playerId)) {
      VisibilityComponent.createOrReplace(entity, { visible: false, propagateToChildren: true })
    }
  }
}

function getCurrentDanceEntries() {
  return gameState.matchPlayers
    .filter(player => player.ready && (player.phase === 'playing' || player.phase === 'gameover'))
    .slice()
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.maxCombo !== a.maxCombo) return b.maxCombo - a.maxCombo
      return a.name.localeCompare(b.name)
    })
}

// ──────────────────────────────────────────────────────────
// 1. 16×16 reflective dance floor
// ──────────────────────────────────────────────────────────
function buildFloor(): void {
  for (let row = 0; row < FLOOR_TILE; row++) {
    for (let col = 0; col < FLOOR_TILE; col++) {
      const e = engine.addEntity()
      const base = TILE_BASE[(row + col) % TILE_BASE.length]
      const x = FLOOR_OX + col + 0.5
      const z = FLOOR_OZ + row + 0.5

      Transform.create(e, {
        position: Vector3.create(x, 0.01, z),
        scale: Vector3.create(TILE_SIZE * 0.97, 0.04, TILE_SIZE * 0.97),
      })
      MeshRenderer.setBox(e)
      pbr(e, base, Color3.create(base.r * 0.4, base.g * 0.4, base.b * 0.4), 0.3)
      tiles.push({ entity: e, baseColor: base, x, z })
    }
  }

  // Raised stage platform under the floor
  const stage = engine.addEntity()
  box(stage, CX, -0.15, CZ, FLOOR_TILE + 2, 0.3, FLOOR_TILE + 2)
  pbr(stage,
    Color4.create(0.04, 0.03, 0.10, 1),
    Color3.create(0.06, 0.03, 0.15),
    0.4, 0.9, 0.1,
  )
}

// ──────────────────────────────────────────────────────────
// 2. Stage backdrop — full 32 m wide back wall
// ──────────────────────────────────────────────────────────
function buildBackdrop(): void {
  // Main dark panel
  const back = engine.addEntity()
  box(back, CX, 5.0, 1.5, 30, 10, 0.25)
  pbr(back,
    Color4.create(0.02, 0.01, 0.08, 1),
    Color3.create(0.06, 0.03, 0.20),
    0.5, 0.95, 0.05,
  )

  // Left neon bar
  const lBar = engine.addEntity()
  box(lBar, 1.8, 5.0, 1.6, 0.18, 10, 0.18)
  pbr(lBar, Color4.create(0.3, 0.5, 1, 1), Color3.create(0.3, 0.5, 1), 3.0, 0.0, 1.0)

  // Right neon bar
  const rBar = engine.addEntity()
  box(rBar, 30.2, 5.0, 1.6, 0.18, 10, 0.18)
  pbr(rBar, Color4.create(1, 0.3, 0.6, 1), Color3.create(1, 0.3, 0.6), 3.0, 0.0, 1.0)

  // Horizontal top strip
  const topStrip = engine.addEntity()
  box(topStrip, CX, 10.1, 1.6, 30, 0.18, 0.18)
  pbr(topStrip, Color4.create(0.8, 0.2, 1.0, 1), Color3.create(0.8, 0.2, 1.0), 2.5, 0.0, 1.0)

  // Horizontal bottom strip
  const botStrip = engine.addEntity()
  box(botStrip, CX, 0.25, 1.6, 30, 0.12, 0.12)
  pbr(botStrip, Color4.create(0.2, 0.8, 1.0, 1), Color3.create(0.2, 0.8, 1.0), 2.0, 0.0, 1.0)

  // Opposite records wall
  const recordsWall = engine.addEntity()
  box(recordsWall, CX, 5, 30.5, 30, 10, 0.25)
  pbr(recordsWall,
    Color4.create(0.02, 0.01, 0.07, 1),
    Color3.create(0.04, 0.02, 0.12),
    0.3, 0.9, 0.1,
  )
}

function buildPhysicalLeaderboard(): void {
  const boardX = 16.0
  const boardZ = 30.18
  const textZ = 29.68
  const rotationY = 0

  glassRoundedSign(boardX, 8.72, boardZ - 0.10, 6.7, 2.35, false)
  beatScoreLogoEntity(boardX, 8.72, textZ, 5.8, 3.17, rotationY)

  const board = engine.addEntity()
  remember(board, currentDanceEntities)
  box(board, boardX, 5.28, boardZ, 10.75, 5.18, 0.16)
  pbr(board,
    Color4.create(0.015, 0.012, 0.045, 0.98),
    Color3.create(0.06, 0.02, 0.16),
    0.9, 0.2, 0.35,
  )

  currentDanceTitleEntity = remember(textEntity('CURRENT DANCE', boardX, 7.50, textZ, 7, Color4.create(0.40, 1.0, 0.85, 1), 0.70, rotationY), currentDanceEntities)
  remember(textEntity('PLAYER', boardX - 2.45, 6.86, textZ - 0.02, 5, Color4.create(0.82, 0.86, 1.0, 1), 0.43, rotationY), currentDanceEntities)
  remember(textEntity('DANCE RANK', boardX - 0.55, 6.86, textZ - 0.02, 5, Color4.create(1.0, 0.58, 1.0, 1), 0.41, rotationY), currentDanceEntities)
  remember(textEntity('RP POINTS', boardX + 1.32, 6.86, textZ - 0.02, 5, Color4.create(1.0, 0.82, 0.22, 1), 0.41, rotationY), currentDanceEntities)
  remember(textEntity('SCORE', boardX + 2.62, 6.86, textZ - 0.02, 5, Color4.create(0.78, 0.92, 1.0, 1), 0.41, rotationY), currentDanceEntities)
  remember(textEntity('WINS', boardX + 3.48, 6.86, textZ - 0.02, 5, Color4.create(0.40, 1.0, 0.85, 1), 0.41, rotationY), currentDanceEntities)
  remember(textEntity('PLACE', boardX + 4.45, 6.86, textZ - 0.02, 5, Color4.create(1.0, 0.82, 0.22, 1), 0.43, rotationY), currentDanceEntities)

  for (let i = 0; i < 5; i++) {
    const y = 6.38 - i * 0.72
    const rowBack = engine.addEntity()
    remember(rowBack, currentDanceEntities)
    box(rowBack, boardX, y, boardZ - 0.10, 10.15, 0.62, 0.08)
    pbr(rowBack,
      i === 0 ? Color4.create(0.18, 0.12, 0.02, 0.95) : Color4.create(0.035, 0.035, 0.09, 0.90),
      i === 0 ? Color3.create(0.75, 0.46, 0.08) : Color3.create(0.08, 0.10, 0.20),
      i === 0 ? 1.2 : 0.45, 0.35, 0.45,
    )

    const placeBadge = engine.addEntity()
    remember(placeBadge, currentDanceEntities)
    box(placeBadge, boardX + 4.45, y, boardZ - 0.18, 0.92, 0.46, 0.06)
    const placeColor = placementColor(i)
    pbr(
      placeBadge,
      placeColor,
      Color3.create(placeColor.r, placeColor.g, placeColor.b),
      i < 3 ? 0.9 : 0.45,
      0.18,
      0.18,
    )

    const rankBadge = engine.addEntity()
    remember(rankBadge, currentDanceEntities)
    box(rankBadge, boardX - 0.55, y, boardZ - 0.18, 1.36, 0.42, 0.06)
    pbr(
      rankBadge,
      Color4.create(0.34, 0.12, 0.58, 0.92),
      Color3.create(0.90, 0.28, 1.0),
      0.62,
      0.18,
      0.20,
    )

    const avatar = engine.addEntity()
    remember(avatar, currentDanceEntities)
    Transform.create(avatar, {
      position: Vector3.create(boardX - 4.35, y, textZ - 0.06),
      rotation: Quaternion.fromEulerDegrees(0, rotationY, 0),
      scale: Vector3.create(0.70, 0.70, 0.70),
    })
    MeshRenderer.setPlane(avatar)
    Material.setBasicMaterial(avatar, {
      diffuseColor: Color4.create(0.05, 0.05, 0.12, 1),
    })

    leaderboardRows.push({
      avatar,
      placeBadge,
      placeText: remember(textEntity(placementLabel(i), boardX + 4.45, y - 0.01, textZ - 0.08, 5, Color4.create(0.04, 0.03, 0.08, 1), 0.43, rotationY), currentDanceEntities),
      nameText: remember(textEntity('---', boardX - 2.45, y - 0.02, textZ - 0.08, 5, Color4.create(0.96, 0.96, 1.0, 1), 0.46, rotationY), currentDanceEntities),
      rankBadgeText: remember(textEntity('Rookie', boardX - 0.55, y - 0.01, textZ - 0.09, 4, Color4.create(1.0, 0.88, 1.0, 1), 0.34, rotationY), currentDanceEntities),
      rpText: remember(textEntity('0', boardX + 1.32, y - 0.02, textZ - 0.08, 5, Color4.create(1.0, 0.82, 0.22, 1), 0.41, rotationY), currentDanceEntities),
      scoreText: remember(textEntity('0', boardX + 2.62, y - 0.02, textZ - 0.08, 5, Color4.create(0.78, 0.92, 1.0, 1), 0.38, rotationY), currentDanceEntities),
      winsText: remember(textEntity('0', boardX + 3.48, y - 0.02, textZ - 0.08, 5, Color4.create(0.40, 1.0, 0.85, 1), 0.41, rotationY), currentDanceEntities),
    })
  }
}

function buildWinnerHighlight(): void {
  const boardX = 16.0
  const boardZ = 30.18
  const textZ = 29.68
  const rotationY = 0

  const panel = engine.addEntity()
  remember(panel, winnerHighlightEntities)
  box(panel, boardX, 5.35, boardZ, 9.6, 5.15, 0.18)
  pbr(panel,
    Color4.create(0.02, 0.01, 0.07, 0.98),
    Color3.create(0.25, 0.04, 0.20),
    1.05, 0.22, 0.25,
  )

  const badge = engine.addEntity()
  remember(badge, winnerHighlightEntities)
  box(badge, boardX, 7.32, boardZ - 0.18, 4.2, 0.72, 0.08)
  pbr(badge,
    Color4.create(1.0, 0.68, 0.08, 0.96),
    Color3.create(1.0, 0.62, 0.16),
    1.15, 0.18, 0.16,
  )

  remember(textEntity('1ST PLACE', boardX, 7.32, textZ - 0.06, 8, Color4.create(0.04, 0.03, 0.08, 1), 0.68, rotationY), winnerHighlightEntities)

  const avatar = engine.addEntity()
  winnerHighlightAvatar = remember(avatar, winnerHighlightEntities)
  Transform.create(avatar, {
    position: Vector3.create(boardX, 5.80, textZ - 0.06),
    rotation: Quaternion.fromEulerDegrees(0, rotationY, 0),
    scale: Vector3.create(1.55, 1.55, 1.55),
  })
  MeshRenderer.setPlane(avatar)
  Material.setBasicMaterial(avatar, {
    diffuseColor: Color4.create(0.05, 0.05, 0.12, 1),
  })

  winnerHighlightNameText = remember(textEntity('---', boardX, 4.34, textZ - 0.06, 9, Color4.create(1.0, 0.48, 0.92, 1), 0.74, rotationY), winnerHighlightEntities)
  winnerHighlightRankText = remember(textEntity('---', boardX, 3.64, textZ - 0.06, 5, Color4.create(0.40, 1.0, 0.85, 1), 0.46, rotationY), winnerHighlightEntities)
  winnerHighlightScoreText = remember(textEntity('SCORE 0', boardX, 3.08, textZ - 0.06, 5, Color4.create(1.0, 0.82, 0.22, 1), 0.46, rotationY), winnerHighlightEntities)

  setEntityGroupVisible(winnerHighlightEntities, false)
}

function buildGlobalRecordsLeaderboard(): void {
  const boardX = 16.0
  const boardZ = 2.35
  const textZ = 2.92
  const rotationY = 180

  glassRoundedSign(boardX, 8.42, textZ - 0.08, 9.2, 1.1, false)
  textEntity('GLOBAL RECORDS', boardX, 8.42, textZ + 0.18, 8, Color4.create(0.40, 1.0, 0.85, 1), 0.66, rotationY)

  const board = engine.addEntity()
  box(board, boardX, 5.28, boardZ, 10.75, 5.18, 0.16)
  pbr(board,
    Color4.create(0.015, 0.012, 0.045, 0.98),
    Color3.create(0.04, 0.10, 0.18),
    0.9, 0.2, 0.35,
  )

  textEntity('PLAYER', boardX - 2.55, 6.98, textZ, 5, Color4.create(0.82, 0.86, 1.0, 1), 0.43, rotationY)
  textEntity('BADGES', boardX - 0.72, 6.98, textZ, 5, Color4.create(1.0, 0.58, 1.0, 1), 0.41, rotationY)
  textEntity('RP', boardX + 0.88, 6.98, textZ, 5, Color4.create(1.0, 0.82, 0.22, 1), 0.41, rotationY)
  textEntity('MAX PERFECT', boardX + 2.15, 6.98, textZ, 5, Color4.create(0.78, 0.92, 1.0, 1), 0.34, rotationY)
  textEntity('PLAYED', boardX + 3.58, 6.98, textZ, 5, Color4.create(0.40, 1.0, 0.85, 1), 0.39, rotationY)

  for (let i = 0; i < 5; i++) {
    const y = 6.36 - i * 0.72
    const rowBack = engine.addEntity()
    box(rowBack, boardX, y, textZ - 0.12, 10.15, 0.62, 0.08)
    pbr(rowBack,
      i === 0 ? Color4.create(0.04, 0.17, 0.20, 0.95) : Color4.create(0.035, 0.035, 0.09, 0.90),
      i === 0 ? Color3.create(0.30, 1.0, 0.85) : Color3.create(0.08, 0.10, 0.20),
      i === 0 ? 1.0 : 0.45, 0.35, 0.45,
    )

    const rankBadge = engine.addEntity()
    box(rankBadge, boardX - 0.72, y, textZ + 0.03, 1.36, 0.42, 0.06)
    pbr(
      rankBadge,
      Color4.create(0.12, 0.22, 0.58, 0.92),
      Color3.create(0.30, 0.72, 1.0),
      0.62,
      0.18,
      0.20,
    )

    const avatar = engine.addEntity()
    Transform.create(avatar, {
      position: Vector3.create(boardX - 4.35, y, textZ + 0.18),
      rotation: Quaternion.fromEulerDegrees(0, rotationY, 0),
      scale: Vector3.create(0.70, 0.70, 0.70),
    })
    MeshRenderer.setPlane(avatar)
    Material.setBasicMaterial(avatar, {
      diffuseColor: Color4.create(0.05, 0.05, 0.12, 1),
    })

    globalRecordRows.push({
      avatar,
      nameText: textEntity('---', boardX - 2.55, y - 0.02, textZ + 0.22, 5, Color4.create(0.96, 0.96, 1.0, 1), 0.46, rotationY),
      rankBadgeText: textEntity('---', boardX - 0.72, y - 0.01, textZ + 0.23, 4, Color4.create(1.0, 0.88, 1.0, 1), 0.34, rotationY),
      rpText: textEntity('0', boardX + 0.88, y - 0.02, textZ + 0.22, 5, Color4.create(1.0, 0.82, 0.22, 1), 0.41, rotationY),
      perfectText: textEntity('0x', boardX + 2.15, y - 0.02, textZ + 0.22, 5, Color4.create(0.78, 0.92, 1.0, 1), 0.38, rotationY),
      playedText: textEntity('0', boardX + 3.58, y - 0.02, textZ + 0.22, 5, Color4.create(0.40, 1.0, 0.85, 1), 0.39, rotationY),
    })
  }
}

function getCurrentDanceDisplayEntries(): MatchPlayer[] {
  if (gameState.phase === 'playing') return getCurrentDanceEntries()
  return lastDanceEntries.length > 0 ? lastDanceEntries : getCurrentDanceEntries()
}

function updateCurrentDancePagination(dt: number): void {
  const rows = getCurrentDanceDisplayEntries()
  const pageCount = Math.max(1, Math.ceil(rows.length / Math.max(leaderboardRows.length, 1)))
  if (pageCount <= 1) {
    currentDancePage = 0
    currentDancePageTimer = 0
    return
  }

  currentDancePageTimer += dt
  if (currentDancePageTimer >= CURRENT_DANCE_PAGE_SECONDS) {
    currentDancePageTimer = 0
    currentDancePage = (currentDancePage + 1) % pageCount
  }
}

function updatePhysicalLeaderboard(): void {
  const allRows = getCurrentDanceDisplayEntries()
  const pageCount = Math.max(1, Math.ceil(allRows.length / Math.max(leaderboardRows.length, 1)))
  const pageStart = (currentDancePage % pageCount) * leaderboardRows.length
  const rows = allRows
    .slice(pageStart, pageStart + leaderboardRows.length)
    .slice(0, leaderboardRows.length)

  leaderboardRows.forEach((row, i) => {
    const placeIndex = pageStart + i
    const entry = rows[i]
    TextShape.getMutable(row.placeText).text = placementLabel(placeIndex)
    const placeColor = placementColor(placeIndex)
    pbr(
      row.placeBadge,
      placeColor,
      Color3.create(placeColor.r, placeColor.g, placeColor.b),
      placeIndex < 3 ? 0.9 : 0.45,
      0.18,
      0.18,
    )

    if (!entry) {
      TextShape.getMutable(row.nameText).text = '---'
      TextShape.getMutable(row.rankBadgeText).text = '---'
      TextShape.getMutable(row.rpText).text = '0'
      TextShape.getMutable(row.scoreText).text = '0'
      TextShape.getMutable(row.winsText).text = '0'
      Material.setBasicMaterial(row.avatar, {
        diffuseColor: Color4.create(0.05, 0.05, 0.12, 1),
      })
      return
    }

    TextShape.getMutable(row.nameText).text = String(entry.name).slice(0, 12)
    TextShape.getMutable(row.rankBadgeText).text = danceRankFromPoints(entry.rankPoints)
    TextShape.getMutable(row.rpText).text = String(entry.rankPoints)
    TextShape.getMutable(row.scoreText).text = String(entry.score)
    TextShape.getMutable(row.winsText).text = String(entry.wins)
    Material.setBasicMaterial(row.avatar, {
      texture: Material.Texture.Avatar({ userId: entry.playerId }),
      diffuseColor: Color4.create(1, 1, 1, 1),
    })
  })
}

function updateGlobalRecordsLeaderboard(): void {
  const rows = gameState.globalLeaderboard
    .slice()
    .sort((a, b) => {
      if (b.rankPoints !== a.rankPoints) return b.rankPoints - a.rankPoints
      if (b.maxCombo !== a.maxCombo) return b.maxCombo - a.maxCombo
      if (b.matchesPlayed !== a.matchesPlayed) return b.matchesPlayed - a.matchesPlayed
      if (b.wins !== a.wins) return b.wins - a.wins
      return b.score - a.score
    })
    .slice(0, globalRecordRows.length)

  globalRecordRows.forEach((row, i) => {
    const entry = rows[i]
    if (!entry) {
      TextShape.getMutable(row.nameText).text = '---'
      TextShape.getMutable(row.rankBadgeText).text = '---'
      TextShape.getMutable(row.rpText).text = '0'
      TextShape.getMutable(row.perfectText).text = '0x'
      TextShape.getMutable(row.playedText).text = '0'
      Material.setBasicMaterial(row.avatar, {
        diffuseColor: Color4.create(0.05, 0.05, 0.12, 1),
      })
      return
    }

    TextShape.getMutable(row.nameText).text = String(entry.name).slice(0, 12)
    TextShape.getMutable(row.rankBadgeText).text = danceRankFromPoints(entry.rankPoints)
    TextShape.getMutable(row.rpText).text = String(entry.rankPoints)
    TextShape.getMutable(row.perfectText).text = `${entry.maxCombo}x`
    TextShape.getMutable(row.playedText).text = String(entry.matchesPlayed)
    Material.setBasicMaterial(row.avatar, {
      texture: Material.Texture.Avatar({ userId: entry.playerId }),
      diffuseColor: Color4.create(1, 1, 1, 1),
    })
  })
}

function updateWinnerHighlight(): void {
  const winner = getCurrentDanceEntries()[0]
  if (!winner) {
    if (winnerHighlightNameText) TextShape.getMutable(winnerHighlightNameText).text = '---'
    if (winnerHighlightRankText) TextShape.getMutable(winnerHighlightRankText).text = '---'
    if (winnerHighlightScoreText) TextShape.getMutable(winnerHighlightScoreText).text = 'SCORE 0'
    if (winnerHighlightAvatar) {
      Material.setBasicMaterial(winnerHighlightAvatar, {
        diffuseColor: Color4.create(0.05, 0.05, 0.12, 1),
      })
    }
    return
  }

  if (winnerHighlightNameText) TextShape.getMutable(winnerHighlightNameText).text = String(winner.name).slice(0, 14)
  if (winnerHighlightRankText) TextShape.getMutable(winnerHighlightRankText).text = `${danceRankFromPoints(winner.rankPoints)}  ${winner.rankPoints} RP`
  if (winnerHighlightScoreText) TextShape.getMutable(winnerHighlightScoreText).text = `SCORE ${winner.score}`
  if (winnerHighlightAvatar) {
    Material.setBasicMaterial(winnerHighlightAvatar, {
      texture: Material.Texture.Avatar({ userId: winner.playerId }),
      diffuseColor: Color4.create(1, 1, 1, 1),
    })
  }
}

function updateCurrentDancePresentation(dt: number): void {
  const winnerCelebrationActive = gameState.winnerCelebrationTimer > 0

  if (gameState.phase !== lastDancePhase) {
    if (lastDancePhase === 'playing' && gameState.phase === 'gameover') {
      lastDanceEntries = getCurrentDanceEntries()
      currentDancePage = 0
      currentDancePageTimer = 0
    }
    if (gameState.phase === 'gameover' && gameState.playMode === 'solo') winnerHighlightTimer = WINNER_HIGHLIGHT_SECONDS
    if (gameState.phase === 'playing') {
      lastDanceEntries = []
      winnerHighlightTimer = 0
      currentDancePage = 0
      currentDancePageTimer = 0
    }
    lastDancePhase = gameState.phase
  }
  if (winnerCelebrationActive && !winnerCelebrationWasActive) winnerHighlightTimer = WINNER_HIGHLIGHT_SECONDS
  winnerCelebrationWasActive = winnerCelebrationActive

  if (gameState.phase === 'gameover') {
    const finalRows = getCurrentDanceEntries()
    if (finalRows.length > 0) lastDanceEntries = finalRows
  }

  if (winnerHighlightTimer > 0) winnerHighlightTimer = Math.max(0, winnerHighlightTimer - dt)
  updateCurrentDancePagination(dt)

  const showWinnerHighlight = gameState.phase === 'gameover' && winnerHighlightTimer > 0
  setEntityGroupVisible(currentDanceEntities, !showWinnerHighlight)
  setEntityGroupVisible(winnerHighlightEntities, showWinnerHighlight)

  if (currentDanceTitleEntity) {
    TextShape.getMutable(currentDanceTitleEntity).text = gameState.phase === 'playing' ? 'CURRENT DANCE' : 'LAST DANCE'
  }

  if (showWinnerHighlight) updateWinnerHighlight()
}

// ──────────────────────────────────────────────────────────
// 4. Overhead lighting truss
// ──────────────────────────────────────────────────────────
function buildTruss(): void {
  // Two parallel truss beams running front-to-back
  for (const tx of [CX - 6, CX + 6]) {
    const beam = engine.addEntity()
    box(beam, tx, 9.6, CZ, 0.22, 0.22, 20)
    pbr(beam, Color4.create(0.2, 0.2, 0.2, 1), Color3.create(0.1, 0.1, 0.1), 0.2, 0.8, 0.3)

    // Hanging spot-light cones along each beam
    const spotPositions = [10, 14, 18, 22]
    const spotColors: Color3[] = [
      Color3.create(1.0, 0.3, 0.6),
      Color3.create(0.3, 0.6, 1.0),
      Color3.create(0.5, 1.0, 0.3),
      Color3.create(1.0, 0.8, 0.2),
    ]

    spotPositions.forEach((sz, i) => {
      // Light housing
      const housing = engine.addEntity()
      box(housing, tx, 9.3, sz, 0.4, 0.4, 0.4)
      pbr(housing, Color4.create(0.1, 0.1, 0.1, 1), Color3.create(0.05, 0.05, 0.05), 0.1, 0.8, 0.4)

      // Glowing lens
      const lens = engine.addEntity()
      box(lens, tx, 9.0, sz, 0.3, 0.12, 0.3)
      const sc = spotColors[i]
      pbr(lens,
        Color4.create(sc.r, sc.g, sc.b, 1),
        sc,
        3.5, 0.0, 1.0,
      )
    })
  }

  // Cross beam left-right at front and back
  for (const tz of [10, 22]) {
    const cross = engine.addEntity()
    box(cross, CX, 9.6, tz, 20, 0.22, 0.22)
    pbr(cross, Color4.create(0.2, 0.2, 0.2, 1), Color3.create(0.1, 0.1, 0.1), 0.2, 0.8, 0.3)
  }
}

// ──────────────────────────────────────────────────────────
// 5. Speaker towers — wider apart on the larger stage
// ──────────────────────────────────────────────────────────
function buildSpeakers(): void {
  const configs: [number, number][] = [
    [4.5,  5.5],   // left front
    [27.5, 5.5],   // right front
    [4.5,  26.5],  // left back
    [27.5, 26.5],  // right back
  ]

  for (const [px, pz] of configs) {
    const faceDir = pz > CZ ? -1 : 1

    // Cabinet
    const cab = engine.addEntity()
    box(cab, px, 2.0, pz, 1.6, 4.0, 1.4)
    pbr(cab, Color4.create(0.05, 0.05, 0.05, 1), Color3.create(0.02, 0.02, 0.02), 0.1, 0.3, 0.8)

    // Woofer
    const woof = engine.addEntity()
    Transform.create(woof, {
      position: Vector3.create(px, 2.0, pz + faceDir * 0.72),
      scale:    Vector3.create(1.15, 1.15, 0.18),
    })
    MeshRenderer.setSphere(woof)
    pbr(woof, Color4.create(0.12, 0.12, 0.12, 1), Color3.create(0.06, 0.06, 0.06), 0.1, 0.6, 0.6)

    // Tweeter glow
    const twt = engine.addEntity()
    Transform.create(twt, {
      position: Vector3.create(px, 3.5, pz + faceDir * 0.73),
      scale:    Vector3.create(0.28, 0.28, 0.1),
    })
    MeshRenderer.setSphere(twt)
    pbr(twt, Color4.create(1, 0.6, 0.1, 1), Color3.create(1, 0.6, 0.1), 2.0, 0.8, 0.2)
  }
}

// ──────────────────────────────────────────────────────────
// 6. Disco balls — main + two flanking
// ──────────────────────────────────────────────────────────
function buildDiscoBalls(): void {
  const configs: [number, number, number, number][] = [
    [CX, 8.5, CZ, 1.65],
  ]

  for (const [x, y, z, r] of configs) {
    const ball = engine.addEntity()
    Transform.create(ball, {
      position: Vector3.create(x, y, z),
      scale:    Vector3.create(r, r, r),
    })
    MeshRenderer.setSphere(ball)
    pbr(ball,
      Color4.create(0.92, 0.92, 0.96, 1),
      Color3.create(0.5, 0.5, 0.55),
      0.7, 1.0, 0.0,
    )
    discoBalls.push(ball)

    // Hanging rod
    const rod = engine.addEntity()
    box(rod, x, y + r * 0.5 + 0.5, z, 0.07, 1.0, 0.07)
    pbr(rod, Color4.create(0.35, 0.35, 0.35, 1), Color3.create(0.12, 0.12, 0.12), 0.1, 0.9, 0.2)
  }
}

// ──────────────────────────────────────────────────────────
// 7. Corner & perimeter light pillars
// ──────────────────────────────────────────────────────────
function buildPillars(): void {
  // 8 pillars around the dance floor
  const positions: [number, number][] = [
    [FLOOR_OX - 1, FLOOR_OZ - 1],
    [FLOOR_OX + FLOOR_TILE + 1, FLOOR_OZ - 1],
    [FLOOR_OX - 1, CZ],
    [FLOOR_OX + FLOOR_TILE + 1, CZ],
    [FLOOR_OX - 1, FLOOR_OZ + FLOOR_TILE + 1],
    [FLOOR_OX + FLOOR_TILE + 1, FLOOR_OZ + FLOOR_TILE + 1],
  ]

  const pillarColors: Color3[] = [
    Color3.create(1.0, 0.2, 0.5),
    Color3.create(0.2, 0.5, 1.0),
    Color3.create(0.5, 1.0, 0.2),
    Color3.create(1.0, 0.8, 0.1),
    Color3.create(0.8, 0.2, 1.0),
    Color3.create(0.2, 1.0, 0.8),
    Color3.create(1.0, 0.5, 0.1),
    Color3.create(0.4, 0.9, 1.0),
  ]

  positions.forEach(([px, pz], i) => {
    // Shaft
    const shaft = engine.addEntity()
    box(shaft, px, 5.0, pz, 0.28, 10, 0.28)
    const c = pillarColors[i]
    pbr(shaft,
      Color4.create(c.r * 0.12, c.g * 0.12, c.b * 0.12, 1),
      c,
      1.8, 0.2, 0.8,
    )

    // Top cap glow
    const cap = engine.addEntity()
    box(cap, px, 10.1, pz, 0.5, 0.5, 0.5)
    pbr(cap,
      Color4.create(c.r, c.g, c.b, 1),
      c,
      4.0, 0.0, 1.0,
    )
  })
}

// ──────────────────────────────────────────────────────────
// 8. Audience bleachers (3 sides around the dance floor)
// ──────────────────────────────────────────────────────────
function buildBleachers(): void {
  // Each bleacher is a stepped set of raised platforms
  // Left side: x = 3–7, z = 7–25
  // Right side: x = 25–29, z = 7–25
  // Back (player-side): x = 7–25, z = 25–30

  const bleacherSections: {
    x: number; y: number; z: number
    sx: number; sy: number; sz: number
  }[] = [
    // Left bleachers (3 steps)
    { x: 5.0, y: 0.4, z: CZ, sx: 1.8, sy: 0.8,  sz: 16 },
    { x: 4.0, y: 1.1, z: CZ, sx: 1.6, sy: 0.8,  sz: 16 },
    { x: 3.0, y: 1.9, z: CZ, sx: 1.6, sy: 0.8,  sz: 16 },
    // Right bleachers
    { x: 27.0, y: 0.4, z: CZ, sx: 1.8, sy: 0.8, sz: 16 },
    { x: 28.0, y: 1.1, z: CZ, sx: 1.6, sy: 0.8, sz: 16 },
    { x: 29.0, y: 1.9, z: CZ, sx: 1.6, sy: 0.8, sz: 16 },
    // Back bleachers
    { x: CX, y: 0.4, z: 26.5, sx: 20, sy: 0.8,  sz: 2.0 },
    { x: CX, y: 1.1, z: 28.0, sx: 20, sy: 0.8,  sz: 2.0 },
    { x: CX, y: 1.9, z: 29.5, sx: 20, sy: 0.8,  sz: 2.0 },
  ]

  for (const s of bleacherSections) {
    const e = engine.addEntity()
    box(e, s.x, s.y, s.z, s.sx, s.sy, s.sz)
    pbr(e,
      Color4.create(0.08, 0.06, 0.16, 1),
      Color3.create(0.04, 0.03, 0.10),
      0.2, 0.6, 0.5,
    )
  }

}

// ──────────────────────────────────────────────────────────
// 9. Floor beat-flash
// ──────────────────────────────────────────────────────────
function triggerBeatFlash(): void {
  const count = 12 + Math.floor(Math.random() * 8)
  const shuffled = [...tiles].sort(() => Math.random() - 0.5).slice(0, count)

  for (const tile of shuffled) {
    const fc = FLASH_POOL[Math.floor(Math.random() * FLASH_POOL.length)]
    setTileFlash(tile, fc, 0.45)
  }
}

function setTileFlash(tile: Tile, flashColor: Color4, duration: number, intensity = 5.0): void {
  const existing = activeFlashes.find(f => f.entity === tile.entity)
  if (existing) {
    existing.flashColor = flashColor
    existing.timer = Math.max(existing.timer, duration)
    existing.duration = Math.max(existing.duration, duration)
    existing.intensity = Math.max(existing.intensity, intensity)
    return
  }

  activeFlashes.push({ entity: tile.entity, baseColor: tile.baseColor, flashColor, timer: duration, duration, intensity })
}

function triggerReactiveFloor(dt: number): void {
  if (gameState.phase === 'playing') return

  reactiveFloorTimer -= dt
  if (reactiveFloorTimer > 0) return

  const player = Transform.getOrNull(engine.PlayerEntity)
  if (!player) return

  const px = player.position.x
  const pz = player.position.z
  const insideFloor =
    px >= FLOOR_OX &&
    px <= FLOOR_OX + FLOOR_TILE &&
    pz >= FLOOR_OZ &&
    pz <= FLOOR_OZ + FLOOR_TILE

  if (!insideFloor) {
    lastReactiveX = Number.NaN
    lastReactiveZ = Number.NaN
    return
  }

  const movedEnough =
    Number.isNaN(lastReactiveX) ||
    Math.hypot(px - lastReactiveX, pz - lastReactiveZ) >= REACTIVE_FLOOR_MOVE_DISTANCE

  if (!movedEnough) return

  reactiveFloorTimer = REACTIVE_FLOOR_INTERVAL
  lastReactiveX = px
  lastReactiveZ = pz

  for (const tile of tiles) {
    const dx = tile.x - px
    const dz = tile.z - pz
    const dist = Math.hypot(dx, dz)
    if (dist > REACTIVE_FLOOR_RADIUS) continue

    const strength = Math.max(0, 1 - dist / REACTIVE_FLOOR_RADIUS)
    const palette = FLASH_POOL[(Math.floor(tile.x * 3 + tile.z * 5 + Date.now() / 180) % FLASH_POOL.length)]
    const blend = 0.08 + strength * 0.13
    const glow = Color4.create(
      tile.baseColor.r + (palette.r - tile.baseColor.r) * blend,
      tile.baseColor.g + (palette.g - tile.baseColor.g) * blend,
      tile.baseColor.b + (palette.b - tile.baseColor.b) * blend,
      1,
    )
    setTileFlash(tile, glow, 0.46 + strength * 0.24, 0.95)
  }
}

// ──────────────────────────────────────────────────────────
// Visual update system (runs every frame)
// ──────────────────────────────────────────────────────────
let lastBeatProcessed = -1

function danceFloorSystem(dt: number): void {
  updateCurrentDancePresentation(dt)
  updatePlayerJudgmentTexts()

  leaderboardTimer += dt
  if (leaderboardTimer >= 1.0) {
    leaderboardTimer = 0
    updatePhysicalLeaderboard()
    updateGlobalRecordsLeaderboard()
  }

  // Beat flash on new beat
  if (gameState.phase === 'playing' && gameState.currentBeat !== lastBeatProcessed) {
    lastBeatProcessed = gameState.currentBeat
    triggerBeatFlash()
  }

  triggerReactiveFloor(dt)

  // Decay tile flashes
  for (let i = activeFlashes.length - 1; i >= 0; i--) {
    const f = activeFlashes[i]
    f.timer -= dt
    if (f.timer <= 0) {
      Material.setPbrMaterial(f.entity, {
        albedoColor:      f.baseColor,
        emissiveColor:    Color3.create(f.baseColor.r * 0.4, f.baseColor.g * 0.4, f.baseColor.b * 0.4),
        emissiveIntensity: 0.3,
        metallic:  0.85,
        roughness: 0.15,
      })
      activeFlashes.splice(i, 1)
    } else {
      const p = f.timer / f.duration
      const blended = Color4.create(
        f.baseColor.r + (f.flashColor.r - f.baseColor.r) * p,
        f.baseColor.g + (f.flashColor.g - f.baseColor.g) * p,
        f.baseColor.b + (f.flashColor.b - f.baseColor.b) * p,
        1,
      )
      Material.setPbrMaterial(f.entity, {
        albedoColor:      blended,
        emissiveColor:    Color3.create(blended.r * p * 3, blended.g * p * 3, blended.b * p * 3),
        emissiveIntensity: p * f.intensity,
        metallic:  0.85,
        roughness: 0.12,
      })
    }
  }

  // Spin disco balls — each at a slightly different speed
  discoBallAngle += dt * 45
  if (discoBallAngle > 360) discoBallAngle -= 360

  discoBalls.forEach((ball, i) => {
    const speed = 1.0 + i * 0.35
    Transform.getMutable(ball).rotation =
      Quaternion.fromEulerDegrees(0, discoBallAngle * speed, 0)
  })
}

// ──────────────────────────────────────────────────────────
// Public initialiser
// ──────────────────────────────────────────────────────────
export function initDanceFloor(): void {
  buildFloor()
  buildBackdrop()
  buildPhysicalLeaderboard()
  buildWinnerHighlight()
  buildGlobalRecordsLeaderboard()
  buildTruss()
  buildSpeakers()
  buildDiscoBalls()
  buildPillars()
  buildBleachers()
  updatePhysicalLeaderboard()
  updateGlobalRecordsLeaderboard()

  engine.addSystem(danceFloorSystem)
}
