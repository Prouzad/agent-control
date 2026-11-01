import { EventEmitter } from 'node:events'

declare global {
  var agentControlBus: EventEmitter | undefined
}

// In-process bus: hook and index events fan out to open SSE streams
export const bus = () => {
  globalThis.agentControlBus ??= new EventEmitter().setMaxListeners(100)
  return globalThis.agentControlBus
}
