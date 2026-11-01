'use client'

import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import {
  Color,
  DoubleSide,
  MeshStandardMaterial,
  Object3D,
  type InstancedMesh,
  type Mesh,
} from 'three'

import { LIVE } from './batch'
import { useMotion } from './motion'

type Vec3 = [number, number, number]

// What a robot is going through right now; drawn as animation around it, never as text
export type Mood =
  | 'burnout'
  | 'overheated'
  | 'stressed'
  | 'scolded'
  | 'angry'
  | 'joking'
  | 'laughing'
  | 'celebrating'

const range = (n: number) => Array.from({ length: n }, (_, i) => i)

// Each particle runs the same 0→1 loop, shifted so they don't move in lockstep
const loop = (time: number, speed: number, i: number, count: number) =>
  (time * speed + i / count) % 1

const fade = (mesh: Mesh, opacity: number) => {
  if (mesh.material instanceof MeshStandardMaterial) mesh.material.opacity = opacity
}

const useParticles = () => {
  const items = useRef<(Mesh | null)[]>([])
  const bind = (i: number) => (mesh: Mesh | null) => {
    items.current[i] = mesh
  }
  return { items, bind }
}

// Burnout: fire on the head
export const Flames = (props: { position: Vec3 }) => {
  const { items, bind } = useParticles()
  useFrame(({ clock }) => {
    items.current.forEach((m, i) => {
      if (!m) return
      const t = clock.elapsedTime * 13 + i * 2.1
      m.scale.set(1, 0.75 + Math.abs(Math.sin(t)) * 0.6, 1)
      m.rotation.y = t * 0.2
    })
  })
  const flames: { x: number; z: number; h: number; color: string }[] = [
    { x: 0, z: 0, h: 0.62, color: '#f97316' },
    { x: -0.2, z: 0.06, h: 0.42, color: '#fb923c' },
    { x: 0.2, z: -0.05, h: 0.46, color: '#fbbf24' },
    { x: 0.03, z: 0.1, h: 0.32, color: '#fde047' },
  ]
  return (
    <group position={props.position}>
      {flames.map((f, i) => (
        <mesh key={i} ref={bind(i)} position={[f.x, f.h / 2, f.z]}>
          <coneGeometry args={[0.13, f.h, 7]} />
          <meshStandardMaterial
            color={f.color}
            emissive={f.color}
            emissiveIntensity={1.6}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  )
}

// Smoke rising from an overheated head
export const Smoke = (props: { position: Vec3; color?: string; count?: number }) => {
  const count = props.count ?? 6
  const { items, bind } = useParticles()
  useFrame(({ clock }) => {
    items.current.forEach((m, i) => {
      if (!m) return
      const p = loop(clock.elapsedTime, 0.45, i, count)
      m.position.set(Math.sin(i * 2.3 + p * 4) * 0.16, p * 1.2, Math.cos(i * 1.7) * 0.06)
      m.scale.setScalar(0.1 + p * 0.3)
      fade(m, 0.65 * (1 - p))
    })
  })
  return (
    <group position={props.position}>
      {range(count).map((i) => (
        <mesh key={i} ref={bind(i)}>
          <sphereGeometry args={[1, 10, 10]} />
          <meshStandardMaterial
            color={props.color ?? '#6b7280'}
            transparent
            opacity={0}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  )
}

// Sweat drops flying off the head
export const Sweat = (props: { position: Vec3 }) => {
  const { items, bind } = useParticles()
  useFrame(({ clock }) => {
    items.current.forEach((m, i) => {
      if (!m) return
      const p = loop(clock.elapsedTime, 0.9, i, 3)
      const side = i % 2 ? 1 : -1
      m.position.set(side * (0.34 + p * 0.25), 0.15 + p * 0.25 - p * p * 0.9, 0.1)
      fade(m, p < 0.85 ? 0.95 : (1 - p) * 6)
    })
  })
  return (
    <group position={props.position}>
      {range(3).map((i) => (
        <mesh key={i} ref={bind(i)} scale={[0.06, 0.095, 0.06]}>
          <sphereGeometry args={[1, 10, 10]} />
          <meshStandardMaterial
            color="#60a5fa"
            emissive="#60a5fa"
            emissiveIntensity={0.3}
            transparent
          />
        </mesh>
      ))}
    </group>
  )
}

// A personal rain cloud over someone whose work was sent back
export const RainCloud = (props: { position: Vec3 }) => {
  const cloud = useRef<Object3D>(null)
  const { items, bind } = useParticles()
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (cloud.current) cloud.current.position.x = Math.sin(t * 1.3) * 0.05
    items.current.forEach((m, i) => {
      if (!m) return
      const p = loop(t, 1.6, i, 6)
      m.position.set(-0.22 + (i % 4) * 0.15, 0.62 - p * 0.55, (i % 2) * 0.08 - 0.04)
      fade(m, 0.85 * (1 - p))
    })
  })
  return (
    <group position={props.position}>
      <group ref={cloud} position={[0, 0.72, 0]}>
        {[
          [-0.17, 0, 0, 0.17],
          [0.02, 0.06, 0, 0.21],
          [0.2, 0, 0, 0.15],
        ].map(([x, y, z, r]) => (
          <mesh key={x} position={[x ?? 0, y ?? 0, z ?? 0]}>
            <sphereGeometry args={[r, 12, 12]} />
            <meshStandardMaterial color="#64748b" roughness={1} />
          </mesh>
        ))}
      </group>
      {range(6).map((i) => (
        <mesh key={i} ref={bind(i)}>
          <boxGeometry args={[0.018, 0.09, 0.018]} />
          <meshStandardMaterial color="#38bdf8" transparent />
        </mesh>
      ))}
    </group>
  )
}

// Steam bursting out of both sides of an angry head
export const Steam = (props: { position: Vec3 }) => {
  const { items, bind } = useParticles()
  useFrame(({ clock }) => {
    items.current.forEach((m, i) => {
      if (!m) return
      const p = loop(clock.elapsedTime, 1.3, Math.floor(i / 2), 3)
      const side = i % 2 ? 1 : -1
      m.position.set(side * (0.36 + p * 0.35), p * 0.3, 0)
      m.scale.setScalar(0.05 + p * 0.12)
      fade(m, 0.9 * (1 - p))
    })
  })
  return (
    <group position={props.position}>
      {range(6).map((i) => (
        <mesh key={i} ref={bind(i)}>
          <sphereGeometry args={[1, 10, 10]} />
          <meshStandardMaterial color="#f8fafc" transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

// The cartoon "anger vein" mark, pulsing on the forehead
export const AngerMark = (props: { position: Vec3 }) => {
  const mark = useRef<Object3D>(null)
  useFrame(({ clock }) => {
    if (mark.current)
      mark.current.scale.setScalar(0.9 + Math.abs(Math.sin(clock.elapsedTime * 8)) * 0.35)
  })
  return (
    <group ref={mark} position={props.position}>
      {[0, 1, 2, 3].map((i) => (
        <group key={i} rotation={[0, 0, (i * Math.PI) / 2]}>
          <mesh position={[0.05, 0.05, 0]} rotation={[0, 0, Math.PI / 4]}>
            <boxGeometry args={[0.09, 0.025, 0.02]} />
            <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={0.8} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

// Little yellow sparks of joy popping above someone laughing
export const Joy = (props: { position: Vec3 }) => {
  const { items, bind } = useParticles()
  useFrame(({ clock }) => {
    items.current.forEach((m, i) => {
      if (!m) return
      const p = loop(clock.elapsedTime, 1.1, i, 4)
      m.position.set(Math.sin(i * 2.5) * 0.3, p * 0.5, 0.1)
      m.scale.setScalar(0.04 * Math.sin(p * Math.PI) + 0.005)
      m.rotation.z = p * 4
    })
  })
  return (
    <group position={props.position}>
      {range(4).map((i) => (
        <mesh key={i} ref={bind(i)}>
          <octahedronGeometry args={[1]} />
          <meshStandardMaterial color="#fde047" emissive="#facc15" emissiveIntensity={1.2} />
        </mesh>
      ))}
    </group>
  )
}

export const THROW_PERIOD = 1.5

// A crumpled paper ball flying in an arc from the angry one to their target, over and over
export const PaperThrow = (props: { from: Vec3; to: Vec3 }) => {
  useMotion(true)
  const ball = useRef<Mesh>(null)
  useFrame(({ clock }) => {
    const m = ball.current
    if (!m) return
    const p = (clock.elapsedTime / THROW_PERIOD) % 1
    // the arm winds up for the first 15% of the period, then the ball flies
    const f = Math.min(1, Math.max(0, (p - 0.15) / 0.6))
    m.visible = p > 0.15 && p < 0.8
    const [ax, ay, az] = props.from
    const [bx, by, bz] = props.to
    m.position.set(
      ax + (bx - ax) * f,
      ay + (by - ay) * f + Math.sin(f * Math.PI) * 1.6,
      az + (bz - az) * f,
    )
    m.rotation.set(f * 9, f * 7, 0)
  })
  return (
    <mesh ref={ball} userData={LIVE}>
      <icosahedronGeometry args={[0.2, 0]} />
      <meshStandardMaterial
        color="#fef3c7"
        emissive="#fde68a"
        emissiveIntensity={0.35}
        flatShading
        roughness={1}
      />
    </mesh>
  )
}

const CONFETTI = 140
const CONFETTI_COLORS = ['#f472b6', '#22d3ee', '#fbbf24', '#a3e635', '#a78bfa', '#fb923c']

// Confetti raining over the whole office when the pipeline is done
export const Confetti = () => {
  // Drifting confetti reads as an idle animation: it does not need 60 fps
  const mesh = useRef<InstancedMesh>(null)
  const dummy = useRef(new Object3D())
  const seeds = useRef(
    range(CONFETTI).map((i) => ({
      x: ((i * 7919) % 240) / 10 - 12,
      z: ((i * 104729) % 160) / 10 - 8,
      speed: 0.25 + ((i * 31) % 10) / 40,
      spin: 2 + (i % 5),
    })),
  )
  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    const color = new Color()
    for (let i = 0; i < CONFETTI; i += 1) {
      m.setColorAt(i, color.set(CONFETTI_COLORS[i % CONFETTI_COLORS.length] ?? '#ffffff'))
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [])
  useFrame(({ clock }) => {
    const m = mesh.current
    if (!m) return
    const t = clock.elapsedTime
    seeds.current.forEach((s, i) => {
      const p = (t * s.speed + i / CONFETTI) % 1
      dummy.current.position.set(s.x + Math.sin(t * 2 + i) * 0.3, 6 - p * 6, s.z)
      dummy.current.rotation.set(t * s.spin, t * s.spin * 0.7, i)
      dummy.current.updateMatrix()
      m.setMatrixAt(i, dummy.current.matrix)
    })
    m.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, CONFETTI]}>
      <planeGeometry args={[0.14, 0.08]} />
      <meshStandardMaterial side={DoubleSide} />
    </instancedMesh>
  )
}
