'use client'

import { RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef, type ReactNode } from 'react'
import { CanvasTexture, type Group, type Mesh, type MeshStandardMaterial } from 'three'

import type { RobotState } from '../Robot'

import { LIVE } from './batch'
import {
  AngerMark,
  Flames,
  Joy,
  RainCloud,
  Smoke,
  Steam,
  Sweat,
  THROW_PERIOD,
  type Mood,
} from './effects'

export type Vec3 = [number, number, number]

// Same palette as the 2D robots: eyes and accents take the team color
export const TEAM_COLORS: Record<string, string> = {
  leadership: '#fbbf24',
  analysis: '#2dd4bf',
  design: '#f472b6',
  frontend: '#22d3ee',
  backend: '#a78bfa',
  mobile: '#4ade80',
  platform: '#fb923c',
  qa: '#a3e635',
  security: '#f87171',
  review: '#60a5fa',
  release: '#cbd5e1',
  data: '#e879f9',
}

export const teamColor = (team: string | null | undefined) =>
  (team && TEAM_COLORS[team]) || '#22d3ee'

const hash = (value: string) => {
  let h = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const Shadowed = (props: { children: ReactNode; position?: Vec3; rotation?: Vec3 }) => (
  <group position={props.position} rotation={props.rotation}>
    {props.children}
  </group>
)

export const BoxMesh = (props: {
  size: Vec3
  position?: Vec3
  color: string
  emissive?: string
  emissiveIntensity?: number
  opacity?: number
  roughness?: number
  // Moving parts stay out of the shadow map, which is drawn once for the still furniture
  moving?: boolean
}) => (
  <mesh position={props.position} castShadow={!props.moving} receiveShadow>
    <boxGeometry args={props.size} />
    <meshStandardMaterial
      color={props.color}
      emissive={props.emissive ?? '#000000'}
      emissiveIntensity={props.emissiveIntensity ?? 0}
      transparent={props.opacity !== undefined}
      opacity={props.opacity ?? 1}
      roughness={props.roughness ?? 0.8}
    />
  </mesh>
)

export const Desk = (props: { position: Vec3; width?: number; color?: string }) => {
  const w = props.width ?? 1.6
  const color = props.color ?? '#e8e2d6'
  return (
    <Shadowed position={props.position}>
      <BoxMesh size={[w, 0.06, 0.8]} position={[0, 0.75, 0]} color={color} />
      <BoxMesh size={[0.06, 0.72, 0.76]} position={[-w / 2 + 0.05, 0.36, 0]} color="#9ca3af" />
      <BoxMesh size={[0.06, 0.72, 0.76]} position={[w / 2 - 0.05, 0.36, 0]} color="#9ca3af" />
      <BoxMesh size={[w - 0.1, 0.4, 0.04]} position={[0, 0.5, 0.36]} color="#d1d5db" />
    </Shadowed>
  )
}

// Laptop on a desk, lid towards the camera: its logo glows in the team color while the agent works
export const Laptop = (props: { position: Vec3; color: string; active: boolean }) => {
  const logo = useRef<MeshStandardMaterial>(null)
  useFrame(({ clock }) => {
    if (logo.current)
      logo.current.emissiveIntensity = props.active
        ? 1.2 + Math.sin(clock.elapsedTime * 6) * 0.6
        : 0.15
  })
  return (
    <Shadowed position={props.position}>
      <BoxMesh size={[0.5, 0.03, 0.34]} position={[0, 0.015, -0.05]} color="#4b5563" />
      <group position={[0, 0.03, 0.1]} rotation={[0.25, 0, 0]}>
        <BoxMesh size={[0.5, 0.34, 0.025]} position={[0, 0.17, 0]} color="#9ca3af" />
        <mesh position={[0, 0.18, 0.015]} userData={LIVE}>
          <circleGeometry args={[0.05, 20]} />
          <meshStandardMaterial
            ref={logo}
            color={props.color}
            emissive={props.color}
            emissiveIntensity={0.2}
          />
        </mesh>
      </group>
    </Shadowed>
  )
}

export const OfficeChair = (props: { position: Vec3; color?: string }) => (
  <Shadowed position={props.position}>
    <BoxMesh size={[0.5, 0.08, 0.5]} position={[0, 0.45, 0]} color={props.color ?? '#3b82f6'} />
    <BoxMesh
      size={[0.5, 0.55, 0.08]}
      position={[0, 0.75, -0.24]}
      color={props.color ?? '#3b82f6'}
    />
    <mesh position={[0, 0.22, 0]} castShadow>
      <cylinderGeometry args={[0.03, 0.03, 0.42]} />
      <meshStandardMaterial color="#374151" />
    </mesh>
    <mesh position={[0, 0.03, 0]}>
      <cylinderGeometry args={[0.26, 0.26, 0.04, 5]} />
      <meshStandardMaterial color="#374151" />
    </mesh>
  </Shadowed>
)

export const Plant = (props: { position: Vec3; scale?: number }) => {
  const s = props.scale ?? 1
  return (
    <group position={props.position} scale={s}>
      <mesh position={[0, 0.22, 0]} castShadow>
        <cylinderGeometry args={[0.22, 0.17, 0.44, 12]} />
        <meshStandardMaterial color="#c2774a" />
      </mesh>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <mesh
          key={i}
          position={[Math.cos(i) * 0.12, 0.75, Math.sin(i) * 0.12]}
          rotation={[Math.cos(i) * 0.5, i, Math.sin(i) * 0.5]}
          castShadow
        >
          <coneGeometry args={[0.12, 0.8, 5]} />
          <meshStandardMaterial color={i % 2 ? '#16a34a' : '#22c55e'} />
        </mesh>
      ))}
    </group>
  )
}

export const WaterCooler = (props: { position: Vec3 }) => (
  <group position={props.position}>
    <BoxMesh size={[0.4, 0.95, 0.4]} position={[0, 0.48, 0]} color="#f1f5f9" />
    <mesh position={[0, 1.15, 0]} castShadow>
      <cylinderGeometry args={[0.16, 0.16, 0.42, 16]} />
      <meshStandardMaterial color="#7dd3fc" transparent opacity={0.8} />
    </mesh>
  </group>
)

// Folder with the task, the thing that travels between desks
export const Folder = (props: { position: Vec3; done?: boolean }) => (
  <group position={props.position}>
    <BoxMesh
      moving
      size={[0.36, 0.05, 0.27]}
      color="#22d3ee"
      emissive="#22d3ee"
      emissiveIntensity={0.25}
    />
    <BoxMesh moving size={[0.3, 0.03, 0.22]} position={[0, 0.035, 0]} color="#f8fafc" />
    {props.done && (
      <BoxMesh
        moving
        size={[0.1, 0.02, 0.1]}
        position={[0, 0.06, 0]}
        color="#34d399"
        emissive="#34d399"
        emissiveIntensity={0.6}
      />
    )}
  </group>
)

// A soft round shadow that travels with a character; the shadow map only holds still things
let blobTexture: CanvasTexture | null = null
const blobShadowTexture = () => {
  if (blobTexture) return blobTexture
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const g = canvas.getContext('2d')
  if (g) {
    const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, 'rgba(0,0,0,0.55)')
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = gradient
    g.fillRect(0, 0, 64, 64)
  }
  blobTexture = new CanvasTexture(canvas)
  return blobTexture
}

export const BlobShadow = (props: { radius: number }) => (
  <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
    <circleGeometry args={[props.radius, 24]} />
    <meshBasicMaterial map={blobShadowTexture()} transparent depthWrite={false} opacity={0.6} />
  </mesh>
)

type RobotProps = {
  seed: string
  team: string | null
  state: RobotState
  position: Vec3
  rotationY?: number
  sitting?: boolean
  walking?: boolean
  mood?: Mood | null
  children?: ReactNode
}

const HAPPY: (Mood | null | undefined)[] = ['joking', 'laughing', 'celebrating']

// A chunky low-poly robot; the animation follows its state
export const Robot3D = (props: RobotProps) => {
  const root = useRef<Group>(null)
  const head = useRef<Group>(null)
  const armL = useRef<Group>(null)
  const armR = useRef<Group>(null)
  const legL = useRef<Group>(null)
  const legR = useRef<Group>(null)
  const visor = useRef<MeshStandardMaterial>(null)
  const visor2 = useRef<MeshStandardMaterial>(null)
  // When the current mood began, so a laugh can wait for the punchline
  const moodSince = useRef<{ mood: Mood | null; at: number }>({ mood: null, at: 0 })
  const h = hash(props.seed)
  const mood = props.mood ?? null
  const phase = (h % 100) / 16
  const color =
    mood === 'angry'
      ? '#ef4444'
      : mood === 'burnout'
        ? '#fb923c'
        : props.state === 'error'
          ? '#f87171'
          : props.state === 'offline'
            ? '#64748b'
            : teamColor(props.team)
  const happyEyes = props.state === 'done' || HAPPY.includes(mood)
  const visorWide = h % 2 === 0
  const antenna = (h >>> 3) % 3

  useFrame(({ clock }) => {
    const now = clock.elapsedTime
    const t = now + phase
    const r = root.current
    if (!r) return
    if (moodSince.current.mood !== mood) moodSince.current = { mood, at: now }
    const inMood = now - moodSince.current.at
    const sitting = props.sitting && mood !== 'celebrating'
    const baseY = sitting ? 0.18 : 0
    let bob = 0
    let shakeX = 0
    let scale = 1.18
    if (props.walking) bob = Math.abs(Math.sin(t * 9)) * 0.06
    else if (mood === 'celebrating') bob = Math.abs(Math.sin(t * 5)) * 0.4
    else if (mood === 'laughing') bob = inMood > 1.2 ? Math.abs(Math.sin(t * 20)) * 0.04 : 0
    else if (mood === 'joking') bob = Math.abs(Math.sin(t * 4)) * 0.05
    else if (mood === 'burnout') bob = -0.06
    else if (props.state === 'working') bob = Math.abs(Math.sin(t * 6)) * 0.02
    else if (props.state === 'done') bob = Math.max(0, Math.sin(t * 2.2)) ** 8 * 0.18
    else bob = Math.sin(t * 1.6) * 0.015
    if (mood === 'angry') shakeX = Math.sin(t * 38) * 0.025
    else if (mood === 'scolded') shakeX = Math.sin(t * 25) * 0.008
    else if (mood === 'overheated') shakeX = Math.sin(t * 30) * 0.012
    else if (props.state === 'error') shakeX = Math.sin(t * 40) > 0.95 ? 0.03 : 0
    if (mood === 'scolded') scale = 1.18 * 0.93
    r.position.y = props.position[1] + baseY + bob
    r.position.x = props.position[0] + shakeX
    r.scale.setScalar(scale)

    const hd = head.current
    if (hd) {
      hd.rotation.x =
        mood === 'burnout'
          ? 0.45
          : mood === 'scolded'
            ? 0.3
            : mood === 'laughing' && inMood > 1.2
              ? -0.4 + Math.sin(t * 20) * 0.06
              : mood === 'celebrating'
                ? -0.25
                : 0
      hd.rotation.y =
        mood === 'overheated' || mood === 'stressed'
          ? Math.sin(t * 9) * 0.22
          : mood === 'joking'
            ? Math.sin(t * 3) * 0.3
            : props.state === 'working'
              ? Math.sin(t * 1.3) * 0.15
              : Math.sin(t * 0.6) * 0.08
      hd.rotation.z =
        mood === 'joking'
          ? Math.sin(t * 4) * 0.12
          : props.state === 'idle' || props.state === 'offline'
            ? Math.sin(t * 0.8) * 0.05
            : 0
    }

    const L = armL.current
    const R = armR.current
    if (L && R) {
      let lx = 0
      let lz = 0
      let rx = 0
      let rz = 0
      if (props.walking) {
        lx = Math.sin(t * 9) * 0.6
        rx = -Math.sin(t * 9) * 0.6
      } else if (mood === 'celebrating') {
        lz = -2.6 + Math.sin(t * 10) * 0.3
        rz = 2.6 - Math.sin(t * 10) * 0.3
      } else if (mood === 'angry') {
        // left fist shakes, right arm throws in time with the paper ball
        lx = -1.7 + Math.sin(t * 22) * 0.25
        const p = (now / THROW_PERIOD) % 1
        rx = p < 0.15 ? -2.9 * (p / 0.15) : -2.9 + Math.min(1, (p - 0.15) / 0.1) * 2.6
      } else if (mood === 'laughing' && inMood > 1.2) {
        // holding the belly
        lx = -0.7
        rx = -0.7
        lz = 0.55
        rz = -0.55
      } else if (mood === 'joking') {
        lx = -1.3 + Math.sin(t * 5) * 0.7
        rz = 1.3 + Math.sin(t * 5 + 1.5) * 0.8
      } else if (mood === 'burnout') {
        lx = sitting ? -0.3 : 0
        rx = sitting ? -0.3 : 0
      } else if (props.state === 'waiting') {
        rz = 2.6 + Math.sin(t * 6) * 0.35
      } else if (props.state === 'working') {
        const speed = mood === 'overheated' || mood === 'stressed' ? 24 : 14
        lx = -1.1 + Math.sin(t * speed) * 0.15
        rx = -1.1 + Math.cos(t * speed) * 0.15
      } else {
        lx = sitting ? -0.9 : 0
        rx = sitting ? -0.9 : 0
      }
      L.rotation.set(lx, 0, lz)
      R.rotation.set(rx, 0, rz)
    }
    if (legL.current && legR.current) {
      const swing = props.walking ? Math.sin(t * 9) * 0.6 : 0
      legL.current.rotation.x = sitting ? -1.5 : swing
      legR.current.rotation.x = sitting ? -1.5 : -swing
    }
    const glow =
      mood === 'burnout'
        ? Math.sin(t * 23) > 0.6
          ? 0.05
          : 0.5
        : mood === 'angry'
          ? 1.6 + Math.sin(t * 12) * 0.5
          : props.state === 'working'
            ? 1.4 + Math.sin(t * 5) * 0.4
            : props.state === 'offline'
              ? 0.15
              : props.state === 'idle'
                ? 0.6
                : 1.1
    if (visor.current) visor.current.emissiveIntensity = glow
    if (visor2.current) visor2.current.emissiveIntensity = glow
  })

  return (
    <group
      ref={root}
      position={props.position}
      rotation={[0, props.rotationY ?? 0, 0]}
      scale={1.18}
      userData={LIVE}
    >
      {/* legs */}
      <group ref={legL} position={[-0.12, 0.42, 0]}>
        <BoxMesh moving size={[0.14, 0.4, 0.16]} position={[0, -0.2, 0]} color="#cbd5e1" />
      </group>
      <group ref={legR} position={[0.12, 0.42, 0]}>
        <BoxMesh moving size={[0.14, 0.4, 0.16]} position={[0, -0.2, 0]} color="#cbd5e1" />
      </group>
      {/* body */}
      <BlobShadow radius={0.42} />
      <RoundedBox args={[0.5, 0.48, 0.34]} radius={0.08} position={[0, 0.66, 0]}>
        <meshStandardMaterial color="#f1f5f9" roughness={0.5} />
      </RoundedBox>
      <mesh position={[0, 0.7, 0.175]}>
        <circleGeometry args={[0.07, 18]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.9} />
      </mesh>
      {/* arms pivot at the shoulders */}
      <group ref={armL} position={[-0.31, 0.84, 0]}>
        <BoxMesh moving size={[0.12, 0.38, 0.14]} position={[0, -0.19, 0]} color="#cbd5e1" />
      </group>
      <group ref={armR} position={[0.31, 0.84, 0]}>
        <BoxMesh moving size={[0.12, 0.38, 0.14]} position={[0, -0.19, 0]} color="#cbd5e1" />
      </group>
      {/* head */}
      <group ref={head} position={[0, 1.13, 0]}>
        <RoundedBox args={[0.62, 0.46, 0.46]} radius={0.12}>
          <meshStandardMaterial color="#f8fafc" roughness={0.4} />
        </RoundedBox>
        <RoundedBox args={[0.5, 0.3, 0.04]} radius={0.06} position={[0, 0, 0.225]}>
          <meshStandardMaterial color="#0b1222" roughness={0.2} />
        </RoundedBox>
        {happyEyes ? (
          <>
            <mesh position={[-0.11, 0.0, 0.25]} rotation={[0, 0, Math.PI]}>
              <torusGeometry args={[0.05, 0.016, 8, 12, Math.PI]} />
              <meshStandardMaterial
                ref={visor}
                color={color}
                emissive={color}
                emissiveIntensity={1.2}
              />
            </mesh>
            <mesh position={[0.11, 0.0, 0.25]} rotation={[0, 0, Math.PI]}>
              <torusGeometry args={[0.05, 0.016, 8, 12, Math.PI]} />
              <meshStandardMaterial
                ref={visor2}
                color={color}
                emissive={color}
                emissiveIntensity={1.2}
              />
            </mesh>
          </>
        ) : visorWide ? (
          <mesh position={[0, 0.01, 0.25]}>
            <boxGeometry args={[0.34, 0.07, 0.01]} />
            <meshStandardMaterial
              ref={visor}
              color={color}
              emissive={color}
              emissiveIntensity={1.2}
            />
          </mesh>
        ) : (
          <>
            <mesh position={[-0.11, 0.01, 0.25]}>
              <sphereGeometry args={[0.05, 12, 12]} />
              <meshStandardMaterial
                ref={visor}
                color={color}
                emissive={color}
                emissiveIntensity={1.2}
              />
            </mesh>
            <mesh position={[0.11, 0.01, 0.25]}>
              <sphereGeometry args={[0.05, 12, 12]} />
              <meshStandardMaterial
                ref={visor2}
                color={color}
                emissive={color}
                emissiveIntensity={1.2}
              />
            </mesh>
          </>
        )}
        {/* antenna */}
        {antenna !== 2 && (
          <mesh position={[0, 0.32, 0]}>
            <cylinderGeometry args={[0.015, 0.015, 0.18]} />
            <meshStandardMaterial color="#94a3b8" />
          </mesh>
        )}
        {antenna === 0 && (
          <mesh position={[0, 0.43, 0]}>
            <sphereGeometry args={[0.05, 12, 12]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1} />
          </mesh>
        )}
        {antenna === 1 && (
          <mesh position={[0, 0.43, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.06, 0.015, 8, 16]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1} />
          </mesh>
        )}
        {antenna === 2 && (
          <>
            <mesh position={[-0.33, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.07, 0.07, 0.06, 14]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} />
            </mesh>
            <mesh position={[0.33, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.07, 0.07, 0.06, 14]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} />
            </mesh>
          </>
        )}
      </group>
      {/* mood effects ride on the robot, above the head */}
      {mood === 'burnout' && (
        <>
          <Flames position={[0, 1.38, 0]} />
          <Smoke position={[0, 1.7, 0]} color="#374151" />
        </>
      )}
      {mood === 'overheated' && (
        <>
          <Smoke position={[0, 1.45, 0]} />
          <Sweat position={[0, 1.13, 0]} />
        </>
      )}
      {mood === 'stressed' && <Sweat position={[0, 1.13, 0]} />}
      {mood === 'scolded' && (
        <>
          <RainCloud position={[0, 1.2, 0]} />
          <Sweat position={[0, 1.13, 0]} />
        </>
      )}
      {mood === 'angry' && (
        <>
          <Steam position={[0, 1.13, 0]} />
          <AngerMark position={[0.2, 1.33, 0.24]} />
        </>
      )}
      {(mood === 'laughing' || mood === 'celebrating') && <Joy position={[0, 1.45, 0]} />}
      {props.children}
    </group>
  )
}

// You, at your desk
export const Human3D = (props: { position: Vec3; deciding: boolean }) => {
  const root = useRef<Group>(null)
  const head = useRef<Group>(null)
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (head.current)
      head.current.rotation.y = props.deciding ? Math.sin(t * 2) * 0.25 : Math.sin(t * 0.5) * 0.1
    if (root.current) root.current.position.y = props.position[1] + Math.sin(t * 1.4) * 0.01
  })
  return (
    <group ref={root} position={props.position} userData={LIVE}>
      <BoxMesh moving size={[0.18, 0.18, 0.5]} position={[-0.13, 0.5, 0.22]} color="#1e3a8a" />
      <BoxMesh moving size={[0.18, 0.18, 0.5]} position={[0.13, 0.5, 0.22]} color="#1e3a8a" />
      <BlobShadow radius={0.5} />
      <RoundedBox args={[0.56, 0.62, 0.34]} radius={0.12} position={[0, 0.9, 0]}>
        <meshStandardMaterial color="#2563eb" />
      </RoundedBox>
      <BoxMesh moving size={[0.14, 0.14, 0.46]} position={[-0.34, 0.98, 0.18]} color="#2563eb" />
      <BoxMesh moving size={[0.14, 0.14, 0.46]} position={[0.34, 0.98, 0.18]} color="#2563eb" />
      <group ref={head} position={[0, 1.42, 0]}>
        <mesh>
          <sphereGeometry args={[0.24, 20, 20]} />
          <meshStandardMaterial color="#f1c7a1" />
        </mesh>
        <mesh position={[0, 0.07, -0.03]} scale={[1.05, 0.85, 1.05]}>
          <sphereGeometry args={[0.24, 20, 20, 0, Math.PI * 2, 0, Math.PI / 1.9]} />
          <meshStandardMaterial color="#3b2a20" />
        </mesh>
        <mesh position={[-0.08, 0.01, 0.22]}>
          <sphereGeometry args={[0.028, 10, 10]} />
          <meshStandardMaterial color="#111827" />
        </mesh>
        <mesh position={[0.08, 0.01, 0.22]}>
          <sphereGeometry args={[0.028, 10, 10]} />
          <meshStandardMaterial color="#111827" />
        </mesh>
      </group>
    </group>
  )
}

// The decision button next to you; it pulses while a gate waits
export const BigButton = (props: { position: Vec3; active: boolean }) => {
  const cap = useRef<Mesh>(null)
  const material = useRef<MeshStandardMaterial>(null)
  useFrame(({ clock }) => {
    const pulse = props.active ? (Math.sin(clock.elapsedTime * 7) + 1) / 2 : 0
    if (material.current)
      material.current.emissiveIntensity = props.active ? 0.6 + pulse * 1.6 : 0.15
    if (cap.current) cap.current.scale.y = props.active ? 1 + pulse * 0.15 : 1
  })
  return (
    <group position={props.position} userData={LIVE}>
      <mesh position={[0, 0.05, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.22, 0.1, 24]} />
        <meshStandardMaterial color="#4b5563" />
      </mesh>
      <mesh ref={cap} position={[0, 0.12, 0]}>
        <sphereGeometry args={[0.15, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial
          ref={material}
          color="#f97316"
          emissive="#f59e0b"
          emissiveIntensity={0.15}
        />
      </mesh>
    </group>
  )
}
