'use client'

import { ContactShadows, OrthographicCamera } from '@react-three/drei'
import { advance, Canvas, useFrame, useThree } from '@react-three/fiber'
import Link from 'next/link'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  CanvasTexture,
  Color,
  SRGBColorSpace,
  Vector3,
  type Group,
  type WebGLRenderer,
} from 'three'

import type { RobotState } from '../Robot'
import {
  BigButton,
  BoxMesh,
  Desk,
  Folder,
  Human3D,
  Laptop,
  OfficeChair,
  Plant,
  Robot3D,
  WaterCooler,
  teamColor,
  type Vec3,
} from './parts'
import { Confetti, PaperThrow, type Mood } from './effects'
import { LIVE, StaticBatch } from './batch'
import { isMoving, useMotion } from './motion'
import { LabelAnchors, LabelLayer, LabelProjector, LabelRegistry, type Label } from './labels'

// Drives the canvas at 60 frames a second while something travels and at 30 when only idle
// animations run; a 120 Hz display would otherwise draw twice as often with no visible gain.
// Nothing is drawn while the office is not seen
const FRAME_MS = 1000 / 60
const IDLE_FRAME_MS = 1000 / 30
const useFrameCap = (active: boolean) => {
  useEffect(() => {
    if (!active) return
    let last = 0
    let id = requestAnimationFrame(function loop(time) {
      // A small slack keeps a 60 Hz display at full rate despite timer jitter
      if (time - last >= (isMoving() ? FRAME_MS : IDLE_FRAME_MS) - 2) {
        last = time
        // The scene's clock runs in seconds, as useFrame animations expect
        advance(time / 1000)
      }
      id = requestAnimationFrame(loop)
    })
    return () => cancelAnimationFrame(id)
  }, [active])
}

// True while the element is at least partly in view and the tab is visible
const useOnScreen = (ref: { current: HTMLElement | null }) => {
  const [inView, setInView] = useState(true)
  const [tabVisible, setTabVisible] = useState(true)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver((entries) =>
      setInView(entries.some((e) => e.isIntersecting)),
    )
    observer.observe(element)
    const onVisibility = () => setTabVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [ref])
  return inView && tabVisible
}

export type OfficeStage = {
  id: string
  kind: 'agent' | 'gate'
  label: string
  roleId: string | null
  roleTitle: string | null
  teamId: string | null
  taskId: string | null
  status: 'pending' | 'running' | 'waiting' | 'done' | 'approved' | 'failed' | 'skipped'
  robot: RobotState
  bubble: string | null
  papers: number
  attempts: number
  // The stage that sent this one back for rework, while that still matters
  scoldedBy: string | null
  // The agent waits for a permission: it walks over to your desk with the request
  asking: boolean
}

export type Idler = { roleId: string; teamId: string }
export type Mate = { roleId: string; title: string }
export type TeamInfo = { id: string; name: string; mates: Mate[] }

type Props = { stages: OfficeStage[]; finished: boolean; idlers: Idler[]; teams: TeamInfo[] }

type P = { x: number; z: number }

// ---------- Building layout (metres; x to the right, z towards the camera) ----------
const WALL_H = 1.3
const ROOM = {
  hall: { x1: -18, x2: -2, z1: -0.6, z2: 1.4, floor: '#a7abbd' },
  corridor: { x1: -2, x2: 2, z1: -8, z2: 8, floor: '#7b7f92' },
  kitchen: { x1: 2, x2: 12, z1: -8, z2: 0.5, floor: '#f3dede' },
  boss: { x1: 2, x2: 8, z1: 0.5, z2: 8, floor: '#c97a42' },
  lounge: { x1: 8, x2: 12, z1: 0.5, z2: 8, floor: '#d6cbb7' },
}

// Wall runs as [x1, z1, x2, z2]; door gaps are simply left out
const WALLS: [number, number, number, number][] = [
  [-18, -8, 12, -8],
  [-18, -8, -18, 8],
  [12, -8, 12, 8],
  [-2, -8, -2, -0.6],
  [-2, 1.4, -2, 8],
  [2, -8, 2, -3.8],
  [2, -2.2, 2, 0.5],
  [2, 0.5, 12, 0.5],
]
// Your office is walled in glass towards the corridor and the lounge
const GLASS: [number, number, number, number][] = [
  [2, 0.5, 2, 4.2],
  [2, 5.8, 2, 8],
  [8, 0.5, 8, 8],
]
const FRONT: [number, number, number, number][] = [
  [-18, 8, -2.2, 8],
  [2.2, 8, 12, 8],
]

// Team wing: a hall runs across the middle, team rooms sit on both sides of it
const WING_LEFT = -18
const WING_RIGHT = -2
const HALL_Z = 0.4
const MAX_COLS = 4
const ROOM_SLOTS = MAX_COLS * 2
const SEAT_DX = [-0.65, 0.65]
const DESK_W = 1.1
const POD_SEATS = SEAT_DX.length
const DOOR = 1.1
const BOSS_DOOR_Z = 5.0
const SPEED = 2.4 // metres per second

type Spot = {
  room: 'team' | 'boss'
  seat: P
  stand: P
  // seat → hall node of the room, and hall node → visitor spot
  exit: P[]
  enter: P[]
  hall: P
  desk: Vec3
}

// As many columns as it takes to give every team a room, rooms above and below the hall
const roomColumns = (teams: number) => Math.min(MAX_COLS, Math.max(1, Math.ceil(teams / 2)))

const roomRect = (slot: number, cols: number) => {
  const top = slot < cols
  const width = (WING_RIGHT - WING_LEFT) / cols
  const x1 = WING_LEFT + width * (slot % cols)
  const x2 = x1 + width
  return {
    top,
    x1,
    x2,
    z1: top ? -8 : 1.4,
    z2: top ? -0.6 : 8,
    cx: (x1 + x2) / 2,
    // desks face the camera; in the upper rooms they keep clear of the hall wall in front
    deskZ: top ? -2.7 : 4.8,
    doorX: x2 - 0.75,
    hallWallZ: top ? -0.6 : 1.4,
    // the team name is painted on the floor along the wall behind the desks
    signZ: top ? -7.35 : 2.05,
  }
}

// Agents step behind their chairs, go to the room door and out into the hall
const seatSpot = (slot: number, seat: number, cols: number): Spot => {
  const room = roomRect(slot, cols)
  const x = room.cx + (SEAT_DX[seat] ?? 0)
  const z = room.deskZ
  const back = z - 1.4
  const hall = { x: room.doorX, z: HALL_Z }
  return {
    room: 'team',
    seat: { x, z: z - 0.78 },
    stand: { x, z: back },
    exit: [{ x, z: z - 0.78 }, { x, z: back }, { x: room.doorX, z: back }, hall],
    enter: [hall, { x: room.doorX, z: back }, { x, z: back }],
    hall,
    desk: [x, 0, z],
  }
}

type Seat =
  | { key: string; kind: 'stage'; index: number; stage: OfficeStage }
  | { key: string; kind: 'mate'; mate: Mate }
type Pod = { key: string; teamId: string | null; name: string; seats: Seat[] }

// Agents sit with their own team; free seats in a pod go to teammates outside this pipeline
const buildPods = (stages: OfficeStage[], teams: TeamInfo[]) => {
  const pods: Pod[] = []
  stages.forEach((stage, index) => {
    if (stage.kind !== 'agent') return
    let pod = pods.find((p) => p.teamId === stage.teamId && p.seats.length < POD_SEATS)
    if (!pod) {
      if (pods.length >= ROOM_SLOTS) return
      const team = teams.find((t) => t.id === stage.teamId)
      pod = { key: stage.id, teamId: stage.teamId, name: team?.name ?? 'Без команды', seats: [] }
      pods.push(pod)
    }
    pod.seats.push({ key: stage.id, kind: 'stage', index, stage })
  })
  const seated = new Set<string>()
  for (const pod of pods) {
    const mates = teams.find((t) => t.id === pod.teamId)?.mates ?? []
    for (const mate of mates) {
      if (pod.seats.length >= POD_SEATS) break
      if (seated.has(mate.roleId)) continue
      seated.add(mate.roleId)
      pod.seats.push({ key: `mate-${mate.roleId}`, kind: 'mate', mate })
    }
  }
  return pods
}

// Kitchen and lounge seats for free leads, in pairs so they have someone to chat with
const BREAK_SEATS: { pos: Vec3; rot: number }[] = [
  { pos: [3.7, 0, -4.5], rot: Math.PI / 2 },
  { pos: [5.3, 0, -4.5], rot: -Math.PI / 2 },
  { pos: [6.7, 0, -1.7], rot: Math.PI / 2 },
  { pos: [8.3, 0, -1.7], rot: -Math.PI / 2 },
  { pos: [9.4, 0.2, 6.7], rot: Math.PI },
  { pos: [10.6, 0.2, 6.7], rot: Math.PI },
]

const BOSS: Spot = {
  room: 'boss',
  seat: { x: 5, z: 3.1 },
  stand: { x: 5, z: 4.95 },
  exit: [{ x: 5, z: 3.1 }],
  enter: [
    { x: 3, z: BOSS_DOOR_Z },
    { x: 5, z: 4.95 },
  ],
  hall: { x: 3, z: BOSS_DOOR_Z },
  desk: [5, 0, 3.9],
}

// Hall node of a room → the corridor, through the room's door
const toCorridor = (spot: Spot): P[] =>
  spot.room === 'team' ? [{ x: -1, z: HALL_Z }] : [{ x: 1, z: BOSS_DOOR_Z }]

const route = (from: Spot, to: Spot): P[] => {
  if (from.room === to.room && from.room === 'team') {
    return [...from.exit, to.hall, ...to.enter.slice(1)]
  }
  const out = toCorridor(from)
  const into = [...toCorridor(to)].reverse()
  const a = out[out.length - 1] ?? from.hall
  const b = into[0] ?? to.hall
  return [...from.exit, ...out, { x: 0, z: a.z }, { x: 0, z: b.z }, ...into, ...to.enter]
}

const length = (points: P[]) =>
  points.slice(1).reduce((sum, p, i) => {
    const q = points[i]
    return q ? sum + Math.hypot(p.x - q.x, p.z - q.z) : sum
  }, 0)

// Position and heading at distance d along a polyline
const sample = (points: P[], d: number) => {
  let left = d
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
    if (!a || !b) continue
    const seg = Math.hypot(b.x - a.x, b.z - a.z)
    if (left <= seg || i === points.length - 1) {
      const t = seg ? Math.min(1, left / seg) : 1
      return {
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        heading: Math.atan2(b.x - a.x, b.z - a.z),
      }
    }
    left -= seg
  }
  const last = points[points.length - 1] ?? { x: 0, z: 0 }
  return { x: last.x, z: last.z, heading: 0 }
}

type Leg = { points: P[]; carrying: boolean; folderAt: number | null }
type Walk = { carrier: number; legs: Leg[]; leg: number }

// ---------- Building ----------
const Floor = (props: { room: (typeof ROOM)[keyof typeof ROOM] }) => {
  const r = props.room
  return (
    <mesh
      position={[(r.x1 + r.x2) / 2, 0.01, (r.z1 + r.z2) / 2]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
    >
      <planeGeometry args={[r.x2 - r.x1, r.z2 - r.z1]} />
      <meshStandardMaterial color={r.floor} roughness={0.9} />
    </mesh>
  )
}

const Wall = (props: {
  run: [number, number, number, number]
  height?: number
  color?: string
  glass?: boolean
}) => {
  const [x1, z1, x2, z2] = props.run
  const h = props.height ?? WALL_H
  const t = 0.2
  const horizontal = z1 === z2
  const len = horizontal ? Math.abs(x2 - x1) : Math.abs(z2 - z1)
  const size: Vec3 = horizontal ? [len + t, h, t] : [t, h, len + t]
  const cap: Vec3 = horizontal ? [len + t, 0.05, t + 0.02] : [t + 0.02, 0.05, len + t]
  const center: Vec3 = [(x1 + x2) / 2, h / 2, (z1 + z2) / 2]
  if (props.glass) {
    return (
      <group>
        <mesh position={center}>
          <boxGeometry args={size} />
          <meshStandardMaterial color="#bae6fd" transparent opacity={0.28} roughness={0.1} />
        </mesh>
        <BoxMesh size={cap} position={[center[0], h, center[2]]} color="#e2e8f0" />
      </group>
    )
  }
  return (
    <group>
      <BoxMesh size={size} position={center} color={props.color ?? '#dfe4ee'} />
      <BoxMesh size={cap} position={[center[0], h + 0.02, center[2]]} color="#ffffff" />
    </group>
  )
}

const Building = (props: { night: boolean }) => (
  <group>
    {Object.values(ROOM).map((room) => (
      <Floor key={`${room.x1}-${room.z1}`} room={room} />
    ))}
    {WALLS.map((run) => (
      <Wall key={run.join()} run={run} />
    ))}
    {GLASS.map((run) => (
      <Wall key={run.join()} run={run} glass />
    ))}
    {FRONT.map((run) => (
      <Wall key={run.join()} run={run} height={0.7} color="#b4533f" />
    ))}
    {/* Windows glowing on the back wall */}
    {[-15, -11, -6, 5, 9].map((x) => (
      <BoxMesh
        key={x}
        size={[1.8, 0.7, 0.04]}
        position={[x, 0.75, -7.88]}
        color="#93c5fd"
        emissive="#93c5fd"
        emissiveIntensity={props.night ? 0.9 : 0.2}
      />
    ))}
    <Plant position={[-2.8, 0, -7.4]} />
    {/* Kitchen: counter, fridge, round tables */}
    <BoxMesh size={[5, 0.9, 0.7]} position={[6, 0.45, -7.5]} color="#f8fafc" />
    <BoxMesh size={[5, 0.06, 0.74]} position={[6, 0.92, -7.5]} color="#94a3b8" />
    <BoxMesh size={[0.9, 1.9, 0.8]} position={[9.6, 0.95, -7.4]} color="#e5e7eb" />
    {[
      [4.5, -4.5],
      [7.5, -4.5],
      [10.3, -4.5],
      [4.5, -1.7],
      [7.5, -1.7],
      [10.3, -1.7],
    ].map(([x, z]) => (
      <group key={`${x}${z}`} position={[x, 0, z]}>
        <mesh position={[0, 0.72, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.55, 0.55, 0.06, 24]} />
          <meshStandardMaterial color="#e7cfa6" />
        </mesh>
        <mesh position={[0, 0.36, 0]}>
          <cylinderGeometry args={[0.06, 0.06, 0.7]} />
          <meshStandardMaterial color="#6b7280" />
        </mesh>
        <BoxMesh size={[0.4, 0.06, 0.4]} position={[-0.8, 0.45, 0]} color="#b91c1c" />
        <BoxMesh size={[0.4, 0.06, 0.4]} position={[0.8, 0.45, 0]} color="#b91c1c" />
      </group>
    ))}
    <WaterCooler position={[-1.4, 0, -1]} />
    {/* Lounge: sofa, coffee table, TV */}
    <BoxMesh size={[2.6, 0.45, 0.9]} position={[10, 0.23, 6.8]} color="#f1f5f9" />
    <BoxMesh size={[2.6, 0.5, 0.25]} position={[10, 0.6, 7.25]} color="#e2e8f0" />
    <BoxMesh size={[1.2, 0.35, 0.7]} position={[10, 0.18, 5.2]} color="#57534e" />
    <BoxMesh size={[2, 0.5, 0.4]} position={[10, 0.25, 1.1]} color="#292524" />
    <BoxMesh
      size={[1.8, 1, 0.08]}
      position={[10, 1.05, 1.15]}
      color="#0f172a"
      emissive="#38bdf8"
      emissiveIntensity={props.night ? 0.6 : 0.25}
    />
    <Plant position={[11.4, 0, 1.2]} scale={1.3} />
    {/* Your office: bookshelf and a plant */}
    <BoxMesh size={[1.8, 1.2, 0.4]} position={[6.5, 0.6, 0.85]} color="#7c4a2a" />
    <BoxMesh size={[1.6, 0.05, 0.35]} position={[6.5, 0.6, 0.9]} color="#5b3720" />
    <Plant position={[2.7, 0, 1.2]} scale={1.2} />
    <Plant position={[-17.4, 0, 7.4]} />
    <Plant position={[-2.6, 0, 7.4]} />
  </group>
)

// Neon sign over the entrance, painted onto a texture so it lives in the 3D scene
const Sign = (props: { position: Vec3 }) => {
  const [texture] = useState(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = 160
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#111827'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.strokeStyle = '#ec4899'
      ctx.lineWidth = 10
      ctx.shadowColor = '#ec4899'
      ctx.shadowBlur = 24
      ctx.strokeRect(14, 14, canvas.width - 28, canvas.height - 28)
      ctx.font = '800 92px system-ui, -apple-system, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#fdf2f8'
      ctx.shadowColor = '#f472b6'
      ctx.shadowBlur = 28
      ctx.fillText('AGENT CONTROL', canvas.width / 2, canvas.height / 2 + 4)
    }
    const map = new CanvasTexture(canvas)
    map.colorSpace = SRGBColorSpace
    return map
  })
  return (
    <mesh position={props.position}>
      <planeGeometry args={[4.4, 0.69]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  )
}

// Team name painted on the floor by the wall behind the desks
const TeamLabel = (props: { name: string; color: string; position: Vec3; width: number }) => {
  const [texture] = useState(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = 160
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = props.color
      ctx.beginPath()
      ctx.roundRect(4, 4, canvas.width - 8, canvas.height - 8, 70)
      ctx.fill()
      ctx.font = '800 92px system-ui, -apple-system, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#0f172a'
      const text = props.name.toUpperCase()
      ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4, canvas.width - 90)
    }
    const map = new CanvasTexture(canvas)
    map.colorSpace = SRGBColorSpace
    map.anisotropy = 8
    return map
  })
  return (
    <mesh position={props.position} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[props.width, props.width * 0.156]} />
      <meshBasicMaterial map={texture} toneMapped={false} transparent />
    </mesh>
  )
}

// A team room: tinted floor, walls to the neighbours and the hall, a door onto the hall
const RoomShell = (props: { slot: number; cols: number; color: string; busy: boolean }) => {
  const room = roomRect(props.slot, props.cols)
  const floor = new Color(props.color).lerp(new Color('#f4ede2'), 0.7)
  const walls: [number, number, number, number][] = [
    [room.x1, room.hallWallZ, room.doorX - DOOR / 2, room.hallWallZ],
    [room.doorX + DOOR / 2, room.hallWallZ, room.x2, room.hallWallZ],
  ]
  if (room.x2 < WING_RIGHT - 0.01) walls.push([room.x2, room.z1, room.x2, room.z2])
  return (
    <group>
      <mesh
        position={[room.cx, 0.012, (room.z1 + room.z2) / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        // Its glow follows the room's work, so it stays out of the still batch
        userData={LIVE}
      >
        <planeGeometry args={[room.x2 - room.x1, room.z2 - room.z1]} />
        <meshStandardMaterial
          color={floor}
          emissive={props.color}
          emissiveIntensity={props.busy ? 0.12 : 0}
          roughness={0.9}
        />
      </mesh>
      {walls.map((run) => (
        <Wall key={run.join()} run={run} />
      ))}
    </group>
  )
}

// A room nobody needs this time becomes the meeting room
const MeetingRoom = (props: { slot: number; cols: number }) => {
  const room = roomRect(props.slot, props.cols)
  const z = (room.z1 + room.z2) / 2
  const back = room.top ? room.z1 + 0.12 : room.hallWallZ + 0.12
  return (
    <group>
      <mesh position={[room.cx, 0.012, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[room.x2 - room.x1, room.z2 - room.z1]} />
        <meshStandardMaterial color="#c46d3a" roughness={0.9} />
      </mesh>
      <BoxMesh size={[2.6, 0.08, 1.2]} position={[room.cx, 0.75, z]} color="#6b4a32" />
      <BoxMesh size={[0.2, 0.7, 0.8]} position={[room.cx, 0.37, z]} color="#4b3424" />
      {[-0.8, 0.8].map((dx) => (
        <group key={dx}>
          <OfficeChair position={[room.cx + dx, 0, z - 1]} color="#d6c4a8" />
          <group rotation={[0, Math.PI, 0]} position={[room.cx + dx, 0, z + 1]}>
            <OfficeChair position={[0, 0, 0]} color="#d6c4a8" />
          </group>
        </group>
      ))}
      <BoxMesh size={[2, 1, 0.06]} position={[room.cx, 1.0, back]} color="#ffffff" />
      <BoxMesh size={[1.3, 0.05, 0.02]} position={[room.cx, 1.15, back + 0.04]} color="#ef4444" />
      <BoxMesh
        size={[0.9, 0.05, 0.02]}
        position={[room.cx - 0.2, 0.95, back + 0.04]}
        color="#3b82f6"
      />
    </group>
  )
}

// A fixed top-down view like a pixel-art office: an orthographic camera tilted just enough to
// show the front faces, zoomed so the building fills the frame edge to edge
const TARGET = new Vector3(-3, 0.4, 0)
const TILT = (66 * Math.PI) / 180 // camera elevation above the floor
const VIEW_DIR = new Vector3(0, Math.sin(TILT), Math.cos(TILT))
// The building as the camera sees it: 30 m wide, its 16 m depth foreshortened by the tilt
const VIEW_WIDTH = 30.4
const VIEW_HEIGHT = 16.4 * Math.sin(TILT) + 1.4 * Math.cos(TILT)
export const OFFICE_ASPECT = VIEW_WIDTH / VIEW_HEIGHT
const CAMERA_DISTANCE = 60
// Labels scale with the orthographic zoom times this factor, so they grow with the frame;
// at a 1000 px wide frame (zoom ≈ 33) they render at their CSS size
const LABEL_SCALE = 1 / 33
// A speech bubble is up to ~7 m wide at that scale: keep its centre far enough from the outer walls
const bubbleX = (x: number) => Math.min(12 - 3.6, Math.max(WING_LEFT + 3.6, x))
const CAMERA_POSITION: Vec3 = [
  TARGET.x + VIEW_DIR.x * CAMERA_DISTANCE,
  TARGET.y + VIEW_DIR.y * CAMERA_DISTANCE,
  TARGET.z + VIEW_DIR.z * CAMERA_DISTANCE,
]

// The default camera, refit whenever the frame changes size
const OfficeCamera = () => {
  const width = useThree((state) => state.size.width)
  const height = useThree((state) => state.size.height)
  const zoom = width && height ? Math.min(width / VIEW_WIDTH, height / VIEW_HEIGHT) : 1
  return (
    <OrthographicCamera makeDefault position={CAMERA_POSITION} zoom={zoom} near={0.1} far={200} />
  )
}

// Points the camera at the building once it exists (props can set position, not direction)
const AimCamera = () => {
  const camera = useThree((state) => state.camera)
  useEffect(() => {
    camera.lookAt(TARGET)
    camera.updateProjectionMatrix()
  }, [camera])
  return null
}

const askLabelId = (stage: OfficeStage) => `ask-${stage.id}`

// ---------- Characters ----------
// An agent with a permission request walks to your desk and waits there; once you decide it
// walks back along the same path
const Asker = (props: {
  stage: OfficeStage
  path: P[]
  asking: boolean
  registry: LabelRegistry
  onDepart: () => void
  onHome: () => void
}) => {
  const group = useRef<Group>(null)
  const travelled = useRef(0)
  const departed = useRef(false)
  const [arrived, setArrived] = useState(false)
  const total = length(props.path)
  useMotion(!arrived)

  useFrame((_, delta) => {
    const g = group.current
    if (!g) return
    const step = delta * SPEED * (props.asking ? 1 : -1)
    travelled.current = Math.min(total, Math.max(0, travelled.current + step))
    const at = sample(props.path, travelled.current)
    g.position.set(at.x, 0, at.z)
    const there = props.asking && travelled.current >= total
    // Facing you at the desk; otherwise facing where it walks
    g.rotation.y = there ? Math.PI : props.asking ? at.heading : at.heading + Math.PI
    if (there !== arrived) setArrived(there)
    if (!departed.current && travelled.current > 0) {
      departed.current = true
      props.onDepart()
    }
    if (departed.current && !props.asking && travelled.current <= 0) {
      departed.current = false
      props.onHome()
    }
  })

  return (
    <group ref={group} userData={LIVE}>
      <Robot3D
        seed={props.stage.roleId ?? props.stage.label}
        team={props.stage.teamId}
        state={arrived ? 'waiting' : 'working'}
        position={[0, 0, 0]}
        walking={!arrived}
      />
      {/* Its request bubble follows it, shown once it stands at your desk */}
      {arrived && (
        <group position={[0, 2.3, 0]} ref={props.registry.anchor(askLabelId(props.stage))} />
      )}
    </group>
  )
}

const Walker = (props: { walk: Walk; stage: OfficeStage; onLegDone: () => void }) => {
  const group = useRef<Group>(null)
  const travelled = useRef(0)
  // One "leg done" per leg, even though frames keep coming until the parent re-renders
  const finished = useRef(false)
  const leg = props.walk.legs[props.walk.leg]
  const total = leg ? length(leg.points) : 0
  useMotion(true)

  useEffect(() => {
    travelled.current = 0
    finished.current = false
  }, [props.walk.leg])

  useFrame((_, delta) => {
    const g = group.current
    if (!g || !leg) return
    travelled.current = Math.min(total, travelled.current + delta * SPEED)
    const at = sample(leg.points, travelled.current)
    g.position.set(at.x, 0, at.z)
    g.rotation.y = at.heading
    if (travelled.current >= total && !finished.current) {
      finished.current = true
      props.onLegDone()
    }
  })

  return (
    <group ref={group} userData={LIVE}>
      <Robot3D
        seed={props.stage.roleId ?? props.stage.label}
        team={props.stage.teamId}
        state="working"
        position={[0, 0, 0]}
        walking
      >
        {leg?.carrying && <Folder position={[0, 1.65, 0.05]} />}
      </Robot3D>
    </group>
  )
}

const useNight = () =>
  useSyncExternalStore(
    (onChange) => {
      const observer = new MutationObserver(onChange)
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      })
      return () => observer.disconnect()
    },
    () => document.documentElement.dataset['theme'] !== 'light',
    () => true,
  )

export const Office3D = (props: Props) => {
  const night = useNight()
  const pods = buildPods(props.stages, props.teams)
  // Rooms and desks follow the teams and the stages; anything else in the scene moves
  const layoutKey = `${props.teams.map((t) => t.id).join()}|${props.stages.map((s) => s.id).join()}`
  const cols = roomColumns(pods.length)
  const spots = new Map<number, Spot>()
  pods.forEach((pod, p) =>
    pod.seats.forEach((seat, s) => {
      if (seat.kind === 'stage') spots.set(seat.index, seatSpot(p, s, cols))
    }),
  )
  const spotOf = (index: number) => spots.get(index) ?? BOSS

  const holder = props.stages.findIndex((s) => s.status === 'running' || s.status === 'waiting')
  const packetIndex = holder >= 0 ? holder : props.finished ? props.stages.length - 1 : -1
  const gate = props.stages.find((s) => s.kind === 'gate' && s.status === 'waiting')
  // Agents away from their desks with a request (or still walking back from one)
  const [out, setOut] = useState<Set<number>>(new Set())
  const anyAsking = props.stages.some((s) => s.asking)

  const previous = useRef(packetIndex)
  const [walk, setWalk] = useState<Walk | null>(null)

  // The agent who finished delivers the folder; after your approval the next agent fetches it
  useEffect(() => {
    const from = previous.current
    previous.current = packetIndex
    if (from === packetIndex || from < 0 || packetIndex < 0) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const a = props.stages[from]
    const b = props.stages[packetIndex]
    if (!a || !b) return
    const fromSpot = spotOf(from)
    const toSpot = spotOf(packetIndex)
    let next: Walk | null = null
    if (a.kind === 'agent') {
      const trip = route(fromSpot, toSpot)
      next = {
        carrier: from,
        leg: 0,
        legs: [
          { points: trip, carrying: true, folderAt: null },
          { points: [...trip].reverse(), carrying: false, folderAt: packetIndex },
        ],
      }
    } else if (b.kind === 'agent') {
      const trip = route(toSpot, fromSpot)
      next = {
        carrier: packetIndex,
        leg: 0,
        legs: [
          { points: trip, carrying: false, folderAt: from },
          { points: [...trip].reverse(), carrying: true, folderAt: null },
        ],
      }
    }
    if (!next) return
    const start = next
    const raf = requestAnimationFrame(() => setWalk(start))
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the folder changes hands
  }, [packetIndex])

  // Rework drama: whoever sent the work back throws paper balls at whoever is redoing it
  const indexById = new Map(props.stages.map((stage, index) => [stage.id, index]))
  const scoldings = props.stages.flatMap((stage, index) => {
    const by = stage.scoldedBy ? indexById.get(stage.scoldedBy) : undefined
    const scolder = by === undefined ? undefined : props.stages[by]
    if (by === undefined || !scolder || scolder.kind !== 'agent' || walk) return []
    if (stage.status !== 'running' && scolder.status !== 'waiting') return []
    return [{ from: by, to: index }]
  })
  const angry = new Set(scoldings.map((s) => s.from))
  const scolded = new Set(scoldings.map((s) => s.to))

  const stageMood = (stage: OfficeStage, index: number): Mood | null => {
    if (props.finished) return 'celebrating'
    if (stage.status === 'failed') return 'burnout'
    if (angry.has(index)) return 'angry'
    if (stage.status === 'running' && stage.attempts >= 2) return 'overheated'
    if (scolded.has(index)) return 'scolded'
    if (stage.status === 'running' && stage.attempts === 1) return 'stressed'
    return null
  }

  // Robots with nothing to do tell each other jokes, within a pod or at a kitchen table
  const calm = (seat: Seat) =>
    seat.kind === 'mate' ||
    (walk?.carrier !== seat.index &&
      !stageMood(seat.stage, seat.index) &&
      ['pending', 'done', 'approved', 'skipped'].includes(seat.stage.status))
  const idlers = props.idlers.slice(0, BREAK_SEATS.length)
  const jokeGroups = [
    ...pods.map((pod) => pod.seats.filter(calm).map((seat) => seat.key)),
    ...[0, 2, 4].map((i) => idlers.slice(i, i + 2).map((idler) => `idle-${idler.roleId}`)),
  ].filter((group) => group.length > 1)
  const groupsRef = useRef<string[][]>([])
  useEffect(() => {
    groupsRef.current = props.finished ? [] : jokeGroups
  })
  const [joke, setJoke] = useState<{ joker: string; laughers: string[] } | null>(null)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let stop: number | undefined
    const timer = window.setInterval(() => {
      const groups = groupsRef.current
      const group = groups[Math.floor(Math.random() * groups.length)]
      if (!group) return
      const j = Math.floor(Math.random() * group.length)
      const joker = group[j]
      if (!joker) return
      setJoke({ joker, laughers: group.filter((_, i) => i !== j) })
      stop = window.setTimeout(() => setJoke(null), 4500)
    }, 8000)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(stop)
    }
  }, [])
  const jokeMood = (key: string): Mood | null =>
    joke?.joker === key ? 'joking' : joke?.laughers.includes(key) ? 'laughing' : null

  const leg = walk?.legs[walk.leg]
  const folderStage = leg ? leg.folderAt : packetIndex >= 0 ? packetIndex : null
  const folderSpot = folderStage !== null && folderStage >= 0 ? spotOf(folderStage) : null
  const carrier = walk ? props.stages[walk.carrier] : undefined

  const [registry] = useState(() => new LabelRegistry())
  // Every label of the scene: desk plates, speech bubbles, sleepers' z's, your plate and requests
  const frame = useRef<HTMLDivElement>(null)
  const onScreen = useOnScreen(frame)
  const renderer = useRef<WebGLRenderer | null>(null)
  useFrameCap(onScreen)
  useEffect(() => {
    const gl = renderer.current
    if (!gl) return
    gl.shadowMap.needsUpdate = true
    // Once more on the next frame, when every mesh of the new layout is mounted
    const next = requestAnimationFrame(() => {
      gl.shadowMap.needsUpdate = true
    })
    return () => cancelAnimationFrame(next)
  }, [layoutKey])
  const labels: Label[] = [
    {
      id: 'boss-plate',
      position: [BOSS.desk[0], 0.45, BOSS.desk[2] + 0.45],
      z: 5,
      content: <div className="desk-plate">Вы</div>,
    },
  ]
  if (gate?.bubble) {
    labels.push({
      id: 'gate-bubble',
      position: [BOSS.seat.x, 2.3, BOSS.seat.z],
      z: 20,
      content: (
        <a href={`#stage-${gate.id}`} className="bubble3d bubble3d--gate">
          {gate.bubble}
        </a>
      ),
    })
  }
  pods.forEach((pod, p) =>
    pod.seats.forEach((seat, s) => {
      if (seat.kind !== 'stage') return
      const spot = seatSpot(p, s, cols)
      const { stage, index } = seat
      const color = teamColor(pod.teamId)
      const away = walk?.carrier === index || stage.asking || out.has(index)
      const handedOver = index === packetIndex - 1 || (props.finished && index === packetIndex)
      const quiet = (stage.status === 'done' || stage.status === 'approved') && !handedOver
      const bubble = quiet || away ? null : stage.bubble
      const mood = stageMood(stage, index) ?? jokeMood(seat.key)
      const plate = `${index + 1}. ${stage.label}`
      labels.push({
        id: `plate-${stage.id}`,
        position: [spot.desk[0], 0.42, spot.desk[2] + 0.45],
        z: 5,
        content: stage.taskId ? (
          <Link href={`/tasks/${stage.taskId}`} className="desk-plate hover:text-accent">
            {plate}
          </Link>
        ) : (
          <div className="desk-plate">{plate}</div>
        ),
      })
      if (bubble) {
        labels.push({
          id: `bubble-${stage.id}`,
          position: [bubbleX(spot.seat.x), mood ? 3.1 : 2.3, spot.seat.z],
          z: 20,
          content: (
            <div className="bubble3d" style={{ borderColor: color }}>
              {bubble}
            </div>
          ),
        })
      }
      if (stage.status === 'pending' && !away && !mood) {
        labels.push({
          id: `zzz-${stage.id}`,
          position: [spot.seat.x + 0.35, 1.85, spot.seat.z],
          z: 5,
          content: (
            <div className="zzz relative h-6 w-6 text-sm" aria-hidden>
              <span>z</span>
              <span>z</span>
              <span>z</span>
            </div>
          ),
        })
      }
    }),
  )
  // A visiting agent's request: anchored to the walking robot, so it has no fixed position
  for (const stage of props.stages) {
    if (stage.kind === 'agent' && stage.bubble && stage.asking) {
      labels.push({
        id: askLabelId(stage),
        z: 25,
        content: (
          <a
            href={`#stage-${stage.id}`}
            className="bubble3d bubble3d--gate"
            style={{ borderColor: teamColor(stage.teamId) }}
          >
            {stage.bubble}
          </a>
        ),
      })
    }
  }

  return (
    <div
      ref={frame}
      className="relative w-full overflow-hidden rounded-2xl"
      style={{ aspectRatio: OFFICE_ASPECT, background: night ? '#16221a' : '#9fd27f' }}
    >
      {/* The scene only refits on resize; re-measuring on every scroll step made it flicker */}
      <Canvas
        shadows="percentage"
        // Rendering stops while the office is off screen or the tab is hidden; Retina is capped
        // at 1.5x, which looks the same at this size and draws about half the pixels of 2x
        // Frames come from FrameCap: at most 60 a second, and none while the office is not seen
        frameloop="never"
        // The shadow map holds only still furniture (characters carry blob shadows), so it is
        // drawn when the layout changes instead of every frame
        onCreated={(state) => {
          state.gl.shadowMap.autoUpdate = false
          state.gl.shadowMap.needsUpdate = true
          renderer.current = state.gl
        }}
        dpr={[1, 1.5]}
        resize={{ scroll: false, debounce: { scroll: 0, resize: 50 } }}
      >
        <color attach="background" args={[night ? '#16221a' : '#9fd27f']} />
        <OfficeCamera />
        <AimCamera />
        <hemisphereLight
          args={[night ? '#94a3b8' : '#ffffff', night ? '#1e293b' : '#a3c99a', night ? 0.85 : 1.1]}
        />
        <directionalLight
          position={[8, 18, 10]}
          intensity={night ? 1.1 : 1.6}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-left={-22}
          shadow-camera-right={16}
          shadow-camera-top={12}
          shadow-camera-bottom={-12}
        />
        {night && <pointLight position={[0, 4, 0]} intensity={18} distance={20} color="#a5b4fc" />}
        <StaticBatch>
          {/* Grass around the building, in case the frame is a touch wider than the building */}
          <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[90, 70]} />
            <meshStandardMaterial color={night ? '#16221a' : '#9fd27f'} />
          </mesh>
          <Building night={night} />
          {/* Drawn once per layout rather than every frame: only the furniture is under it */}
          <ContactShadows
            key={layoutKey}
            frames={1}
            position={[-3, 0.02, 0]}
            opacity={0.25}
            scale={36}
            blur={2.5}
            far={4}
          />

          {/* Entrance sign */}
          <BoxMesh
            size={[4.4, 0.7, 0.15]}
            position={[0, 1.4, 8.1]}
            color="#111827"
            emissive="#ec4899"
            emissiveIntensity={0.15}
          />
          <Sign position={[0, 1.4, 8.185]} />

          {/* Your desk and you */}
          <Desk position={BOSS.desk} width={2.4} color="#5b3720" />
          <OfficeChair position={[BOSS.seat.x, 0, BOSS.seat.z - 0.05]} color="#111827" />
          <Human3D
            position={[BOSS.seat.x, 0.02, BOSS.seat.z]}
            deciding={Boolean(gate) || anyAsking}
          />
          <Laptop
            position={[BOSS.desk[0] - 0.5, 0.78, BOSS.desk[2]]}
            color="#fbbf24"
            active={false}
          />
          <BigButton
            position={[BOSS.desk[0] + 0.75, 0.78, BOSS.desk[2] + 0.05]}
            active={Boolean(gate) || anyAsking}
          />
          {/* Team rooms, and meeting rooms in the slots no team needs */}
          {Array.from({ length: cols * 2 - pods.length }, (_, i) => (
            <MeetingRoom key={`meeting-${i}`} slot={pods.length + i} cols={cols} />
          ))}
          {pods.map((pod, p) => {
            const room = roomRect(p, cols)
            const color = teamColor(pod.teamId)
            const busy = pod.seats.some(
              (seat) =>
                seat.kind === 'stage' &&
                (seat.stage.status === 'running' || seat.stage.status === 'waiting'),
            )
            return (
              <group key={pod.key}>
                <RoomShell slot={p} cols={cols} color={color} busy={busy} />
                <TeamLabel
                  name={pod.name}
                  color={color}
                  position={[room.cx, 0.03, room.signZ]}
                  width={Math.min(3.2, room.x2 - room.x1 - 0.6)}
                />
                {pod.seats.map((seat, s) => {
                  const spot = seatSpot(p, s, cols)
                  if (seat.kind === 'mate') {
                    return (
                      <group key={seat.key}>
                        <Desk position={spot.desk} width={DESK_W} />
                        <OfficeChair position={[spot.seat.x, 0, spot.seat.z - 0.05]} />
                        <Laptop
                          position={[spot.desk[0] - 0.25, 0.78, spot.desk[2]]}
                          color={color}
                          active={false}
                        />
                        <Robot3D
                          seed={seat.mate.roleId}
                          team={pod.teamId}
                          state="idle"
                          position={[spot.seat.x, 0, spot.seat.z]}
                          sitting
                          mood={props.finished ? 'celebrating' : jokeMood(seat.key)}
                        />
                      </group>
                    )
                  }
                  const { stage, index } = seat
                  const away = walk?.carrier === index || stage.asking || out.has(index)
                  const active = stage.status === 'running' || stage.status === 'waiting'
                  const mood = stageMood(stage, index) ?? jokeMood(seat.key)
                  return (
                    <group key={seat.key}>
                      <Desk position={spot.desk} width={DESK_W} />
                      <OfficeChair position={[spot.seat.x, 0, spot.seat.z - 0.05]} />
                      <Laptop
                        position={[spot.desk[0] - 0.25, 0.78, spot.desk[2]]}
                        color={color}
                        active={active}
                      />
                      {Array.from({ length: Math.min(stage.papers, 5) }, (_, i) => (
                        <BoxMesh
                          key={i}
                          size={[0.3, 0.02, 0.22]}
                          position={[spot.desk[0] + 0.33, 0.79 + i * 0.025, spot.desk[2] - 0.08]}
                          color="#f8fafc"
                        />
                      ))}
                      {!away && (
                        <Robot3D
                          seed={stage.roleId ?? stage.label}
                          team={stage.teamId}
                          state={stage.robot}
                          position={[spot.seat.x, 0, spot.seat.z]}
                          sitting
                          mood={mood}
                        />
                      )}
                    </group>
                  )
                })}
              </group>
            )
          })}

          {scoldings.map((s) => {
            const from = spotOf(s.from)
            const to = spotOf(s.to)
            return (
              <PaperThrow
                key={`${s.from}-${s.to}`}
                from={[from.seat.x + 0.4, 1.9, from.seat.z]}
                to={[to.seat.x, 1.75, to.seat.z]}
              />
            )
          })}

          {props.stages.map((stage, index) =>
            stage.kind === 'agent' &&
            (stage.asking || out.has(index)) &&
            walk?.carrier !== index ? (
              <Asker
                key={`ask-${stage.id}`}
                stage={stage}
                path={route(spotOf(index), BOSS)}
                asking={stage.asking}
                registry={registry}
                onDepart={() => setOut((current) => new Set(current).add(index))}
                onHome={() =>
                  setOut((current) => {
                    const next = new Set(current)
                    next.delete(index)
                    return next
                  })
                }
              />
            ) : null,
          )}

          {/* Free leads taking a break in the kitchen and the lounge */}
          {idlers.map((idler, i) => {
            const place = BREAK_SEATS[i]
            if (!place) return null
            const key = `idle-${idler.roleId}`
            return (
              <Robot3D
                key={key}
                seed={idler.roleId}
                team={idler.teamId}
                state="idle"
                position={place.pos}
                rotationY={place.rot}
                mood={props.finished ? 'celebrating' : jokeMood(key)}
              />
            )
          })}

          {props.finished && <Confetti />}

          {folderSpot && (
            <group
              position={
                folderSpot.room === 'boss'
                  ? [BOSS.desk[0] - 0.05, 0.8, BOSS.desk[2] + 0.1]
                  : [folderSpot.desk[0] + 0.33, 0.86, folderSpot.desk[2] + 0.1]
              }
            >
              <Folder position={[0, 0, 0]} done={props.finished} />
            </group>
          )}

          {walk && carrier && (
            <Walker
              walk={walk}
              stage={carrier}
              onLegDone={() =>
                setWalk((current) =>
                  current && current.leg + 1 < current.legs.length
                    ? { ...current, leg: current.leg + 1 }
                    : null,
                )
              }
            />
          )}
        </StaticBatch>
        <LabelAnchors registry={registry} labels={labels} />
        <LabelProjector registry={registry} scale={LABEL_SCALE} />
      </Canvas>
      <LabelLayer registry={registry} labels={labels} />
    </div>
  )
}
