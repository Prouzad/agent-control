export type RobotState = 'idle' | 'working' | 'waiting' | 'error' | 'done' | 'offline'

type Props = {
  // Same seed, same robot: role ids give every role a stable face
  seed: string
  team?: string | null
  state?: RobotState
  size?: number
  label?: string
  className?: string
}

// FNV-1a: small, stable and good enough to spread variants
const hash = (value: string) => {
  let h = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const pickVariant = (h: number, shift: number, count: number) => (h >>> shift) % count

const Antenna = (props: { variant: number }) => {
  switch (props.variant) {
    case 1:
      return (
        <>
          <line className="r-line" x1="26" y1="14" x2="22.5" y2="7.5" strokeWidth="1.6" />
          <line className="r-line" x1="38" y1="14" x2="41.5" y2="7.5" strokeWidth="1.6" />
          <circle className="r-bulb" cx="22" cy="6.5" r="2" />
          <circle className="r-bulb" cx="42" cy="6.5" r="2" />
        </>
      )
    case 2:
      return (
        <>
          <line className="r-line" x1="32" y1="14" x2="32" y2="10" strokeWidth="1.6" />
          <circle className="r-line" cx="32" cy="6.5" r="3.4" strokeWidth="1.6" />
          <circle className="r-bulb" cx="32" cy="6.5" r="1.2" />
        </>
      )
    case 3:
      return <rect className="r-bulb" x="28" y="9.5" width="8" height="4.5" rx="2.2" />
    default:
      return (
        <>
          <line className="r-line" x1="32" y1="14" x2="32" y2="8" strokeWidth="1.6" />
          <circle className="r-bulb" cx="32" cy="6" r="2.6" />
        </>
      )
  }
}

const Eyes = (props: { variant: number; state: RobotState }) => {
  if (props.state === 'done') {
    return (
      <g className="r-eyes">
        <path className="r-line" d="M22.5 29 q3.5 -4.5 7 0" strokeWidth="2.2" />
        <path className="r-line" d="M34.5 29 q3.5 -4.5 7 0" strokeWidth="2.2" />
      </g>
    )
  }
  if (props.state === 'error') {
    return (
      <g className="r-eyes">
        <path className="r-line" d="M23.5 24.5 l5 5 M28.5 24.5 l-5 5" strokeWidth="2" />
        <path className="r-line" d="M35.5 24.5 l5 5 M40.5 24.5 l-5 5" strokeWidth="2" />
      </g>
    )
  }
  const wide = props.state === 'waiting' ? 1.2 : 1
  switch (props.variant) {
    case 1:
      return (
        <g className="r-eyes">
          <ellipse className="r-eye" cx="26" cy="27" rx={2.3 * wide} ry={3.5 * wide} />
          <ellipse className="r-eye" cx="38" cy="27" rx={2.3 * wide} ry={3.5 * wide} />
        </g>
      )
    case 2:
      return (
        <g className="r-eyes">
          <rect
            className="r-eye"
            x={23 - wide}
            y="25"
            width={6 * wide}
            height={4 * wide}
            rx="1.6"
          />
          <rect
            className="r-eye"
            x={35 - wide}
            y="25"
            width={6 * wide}
            height={4 * wide}
            rx="1.6"
          />
        </g>
      )
    case 3:
      return (
        <g className="r-eyes">
          <rect className="r-eye" x="21" y="25" width="22" height={4 * wide} rx="2" />
        </g>
      )
    default:
      return (
        <g className="r-eyes">
          <circle className="r-eye" cx="26" cy="27" r={3 * wide} />
          <circle className="r-eye" cx="38" cy="27" r={3 * wide} />
        </g>
      )
  }
}

const Mouth = (props: { variant: number; state: RobotState }) => {
  if (props.state === 'done')
    return <path className="r-line" d="M28 33.5 q4 3 8 0" strokeWidth="1.6" />
  if (props.state === 'error')
    return (
      <path className="r-line" d="M27 34 l2 -1.5 l2 1.5 l2 -1.5 l2 1.5 l2 -1.5" strokeWidth="1.3" />
    )
  switch (props.variant) {
    case 1:
      return <path className="r-line" d="M28.5 33.5 q3.5 2.5 7 0" strokeWidth="1.6" />
    case 2:
      return (
        <>
          <circle className="r-eye" cx="29" cy="34" r="0.9" />
          <circle className="r-eye" cx="32" cy="34" r="0.9" />
          <circle className="r-eye" cx="35" cy="34" r="0.9" />
        </>
      )
    default:
      return <line className="r-line" x1="29" y1="34" x2="35" y2="34" strokeWidth="1.6" />
  }
}

const STATE_LABEL: Record<RobotState, string> = {
  idle: 'ждёт задачу',
  working: 'работает',
  waiting: 'ждёт вашего решения',
  error: 'ошибка',
  done: 'готово',
  offline: 'не активен',
}

export const Robot = (props: Props) => {
  const state = props.state ?? 'idle'
  const size = props.size ?? 48
  const h = hash(props.seed)
  const head = pickVariant(h, 0, 3)
  const antenna = pickVariant(h, 3, 4)
  const eyes = pickVariant(h, 7, 4)
  const mouth = pickVariant(h, 11, 3)
  const torso = pickVariant(h, 14, 3)
  const label = props.label ? `${props.label}: ${STATE_LABEL[state]}` : undefined

  // The shadow and the robot are two layers. The hover and hop move an HTML wrapper: the browser
  // runs that on the GPU, while an animated SVG element (even the <svg> itself) repaints every frame
  return (
    <span
      className={`robot robot--${state} ${props.className ?? ''}`}
      style={{ width: size, height: size * 1.125 }}
      data-team={props.team ?? 'none'}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg viewBox="0 0 64 72" aria-hidden>
        <ellipse cx="32" cy="69" rx="13" ry="2.4" fill="black" opacity="0.22" />
      </svg>
      <span className="r-all">
        <svg viewBox="0 0 64 72" aria-hidden>
          <Antenna variant={antenna} />
          <rect className="r-shade" x="8" y="24" width="5" height="10" rx="2.2" />
          <rect className="r-shade" x="51" y="24" width="5" height="10" rx="2.2" />
          <rect className="r-body" x="12" y="14" width="40" height="30" rx={[9, 13, 15][head]} />
          <rect
            className="r-screen"
            x="17"
            y="19"
            width="30"
            height="19.5"
            rx={[6, 8, 9.5][head]}
          />
          <Eyes variant={eyes} state={state} />
          <Mouth variant={mouth} state={state} />
          <rect className="r-shade" x="28" y="44" width="8" height="3.5" rx="1" />
          <g className="r-arm-l">
            <rect className="r-shade" x="11" y="48" width="7" height="12" rx="3.5" />
          </g>
          <g className="r-arm-r">
            <rect className="r-shade" x="46" y="48" width="7" height="12" rx="3.5" />
          </g>
          <rect className="r-body" x="19" y="47" width="26" height="16" rx={[6, 4, 8][torso]} />
          {torso === 1 ? (
            <rect className="r-chest" x="26" y="53.5" width="12" height="3" rx="1.5" />
          ) : (
            <circle className="r-chest" cx="32" cy="55" r="2.6" />
          )}
          {state === 'waiting' && (
            <g className="r-alert">
              <circle cx="53" cy="8" r="6" fill="var(--warning)" />
              <rect x="52.1" y="4.3" width="1.8" height="4.8" rx="0.9" fill="var(--robot-screen)" />
              <circle cx="53" cy="11.2" r="1" fill="var(--robot-screen)" />
            </g>
          )}
        </svg>
      </span>
    </span>
  )
}
