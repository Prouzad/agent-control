'use client'

import { useFrame } from '@react-three/fiber'
import type { ReactNode } from 'react'
import { OrthographicCamera, Vector3, type Camera, type Object3D } from 'three'

type Vec3 = [number, number, number]

export type Label = {
  id: string
  // Where the label sits in the scene; a moving character anchors its own label instead
  position?: Vec3
  z: number
  content: ReactNode
}

// Labels live in one plain DOM layer over the canvas. The scene only holds invisible anchors,
// and every frame each label is moved to its anchor's place on screen. This replaces drei's Html,
// which mounted a separate React root per label and warned under React 19
export class LabelRegistry {
  readonly anchors = new Map<string, Object3D>()
  readonly elements = new Map<string, HTMLElement>()
  private readonly point = new Vector3()
  // Last transform written per element, so the DOM is touched only when something moved
  private readonly placed = new Map<HTMLElement, string>()

  anchor(id: string) {
    return (object: Object3D | null) => {
      if (object) this.anchors.set(id, object)
      else this.anchors.delete(id)
    }
  }

  element(id: string) {
    return (element: HTMLElement | null) => {
      if (element) this.elements.set(id, element)
      else this.elements.delete(id)
    }
  }

  // Moves every label to its anchor's spot on screen; labels without an anchor are hidden
  project(camera: Camera, size: { width: number; height: number }, scale: number) {
    const zoom = camera instanceof OrthographicCamera ? camera.zoom : 1
    for (const [id, element] of this.elements) {
      const anchor = this.anchors.get(id)
      let transform = 'none'
      if (anchor) {
        anchor.getWorldPosition(this.point).project(camera)
        const x = ((this.point.x + 1) / 2) * size.width
        const y = ((1 - this.point.y) / 2) * size.height
        transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%) scale(${(zoom * scale).toFixed(3)})`
      }
      if (this.placed.get(element) === transform) continue
      this.placed.set(element, transform)
      element.style.visibility = anchor ? 'visible' : 'hidden'
      if (anchor) element.style.transform = transform
    }
  }
}

// Inside the Canvas: anchors for labels that stay put
export const LabelAnchors = (props: { registry: LabelRegistry; labels: Label[] }) => (
  <>
    {props.labels.map((label) =>
      label.position ? (
        <group key={label.id} position={label.position} ref={props.registry.anchor(label.id)} />
      ) : null,
    )}
  </>
)

// Inside the Canvas: places the labels every frame, scaled with the orthographic zoom
export const LabelProjector = (props: { registry: LabelRegistry; scale: number }) => {
  useFrame((state) => props.registry.project(state.camera, state.size, props.scale))
  return null
}

// Outside the Canvas: the labels themselves, hidden until their anchor is placed
export const LabelLayer = (props: { registry: LabelRegistry; labels: Label[] }) => (
  <div className="pointer-events-none absolute inset-0 overflow-hidden">
    {props.labels.map((label) => (
      <div
        key={label.id}
        ref={props.registry.element(label.id)}
        className="pointer-events-auto absolute top-0 left-0 will-change-transform"
        style={{ zIndex: label.z, visibility: 'hidden' }}
      >
        {label.content}
      </div>
    ))}
  </div>
)
