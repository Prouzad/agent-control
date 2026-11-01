'use client'

import { useFrame } from '@react-three/fiber'
import { useRef, type ReactNode } from 'react'
import {
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type BufferGeometry,
  type Group,
  type Object3D,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// userData for anything that moves or changes on its own: the batcher leaves the whole subtree
// alone and it is drawn as before
export const LIVE = { live: true }

type Plain = MeshStandardMaterial | MeshBasicMaterial

const plainMaterial = (mesh: Mesh): Plain | null => {
  const material = mesh.material
  if (Array.isArray(material)) return null
  if (!(material instanceof MeshStandardMaterial) && !(material instanceof MeshBasicMaterial))
    return null
  return material.map || material.transparent ? null : material
}

// Meshes that look the same once merged: same material settings and the same shadow roles
const lookKey = (mesh: Mesh, material: Plain) =>
  [
    material.type,
    material.color.getHex(),
    material instanceof MeshStandardMaterial
      ? `${material.emissive.getHex()}/${material.emissiveIntensity}/${material.roughness}/${material.metalness}`
      : '',
    material.side,
    material.toneMapped,
    mesh.castShadow,
    mesh.receiveShadow,
  ].join('|')

type Candidate = { mesh: Mesh; material: Plain; key: string }

const collect = (root: Object3D, out: Candidate[]) => {
  for (const child of root.children) {
    if (child.userData['live'] || child.userData['batch']) continue
    if (child instanceof Mesh && !(child instanceof InstancedMesh)) {
      const material = plainMaterial(child)
      // Hidden by the scene itself (not by us) means it is not part of the picture now
      if (material && (child.visible || child.userData['batched']))
        out.push({ mesh: child, material, key: lookKey(child, material) })
    }
    collect(child, out)
  }
}

// Position and normal only: the merged materials carry no textures
const bakedGeometry = (mesh: Mesh, toRoot: Matrix4): BufferGeometry => {
  const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name)
  }
  geometry.applyMatrix4(new Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld))
  return geometry
}

const CHECK_EVERY_FRAMES = 15

// Still furniture is drawn as one mesh per look instead of hundreds of small ones: the picture
// is the same, the draw calls are not. When the still part of the scene changes (a desk, a
// stack of papers, the night colors), the batch is rebuilt within half a second
export const StaticBatch = (props: { children: ReactNode }) => {
  const root = useRef<Group>(null)
  const merged = useRef<Mesh[]>([])
  const signature = useRef('')
  const frame = useRef(0)

  useFrame((state) => {
    frame.current += 1
    const group = root.current
    if (!group || frame.current % CHECK_EVERY_FRAMES !== 1) return
    const candidates: Candidate[] = []
    collect(group, candidates)
    const next = candidates.map((c) => `${c.mesh.id}:${c.key}`).join(',')
    if (next === signature.current) return
    signature.current = next

    for (const mesh of merged.current) {
      group.remove(mesh)
      mesh.geometry.dispose()
      if (!Array.isArray(mesh.material)) mesh.material.dispose()
    }
    merged.current = []
    for (const c of candidates) {
      c.mesh.visible = true
      c.mesh.userData['batched'] = false
    }

    group.updateWorldMatrix(true, true)
    const toRoot = new Matrix4().copy(group.matrixWorld).invert()
    const byLook = new Map<string, Candidate[]>()
    for (const c of candidates) byLook.set(c.key, [...(byLook.get(c.key) ?? []), c])
    for (const members of byLook.values()) {
      const first = members[0]
      if (!first || members.length < 2) continue
      const parts = members.map((c) => bakedGeometry(c.mesh, toRoot))
      const geometry = mergeGeometries(parts)
      for (const part of parts) part.dispose()
      if (!geometry) continue
      const mesh = new Mesh(geometry, first.material.clone())
      mesh.castShadow = first.mesh.castShadow
      mesh.receiveShadow = first.mesh.receiveShadow
      mesh.userData['batch'] = true
      group.add(mesh)
      merged.current.push(mesh)
      for (const c of members) {
        c.mesh.visible = false
        c.mesh.userData['batched'] = true
      }
    }
    // The still shadows were drawn from the old meshes
    state.gl.shadowMap.needsUpdate = true
  })

  return <group ref={root}>{props.children}</group>
}
