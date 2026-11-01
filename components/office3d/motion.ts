import { useEffect } from 'react'

// How many things travel across the office right now. While any do, the office draws at 60 fps;
// with only idle animations (breathing robots, glowing laptops) 30 fps looks the same
let moving = 0

export const isMoving = () => moving > 0

export const useMotion = (active: boolean) => {
  useEffect(() => {
    if (!active) return
    moving += 1
    return () => {
      moving -= 1
    }
  }, [active])
}
