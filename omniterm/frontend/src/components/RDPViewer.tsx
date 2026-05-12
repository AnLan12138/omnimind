import { useEffect, useRef, useCallback, useState } from 'react'
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime'
import { RDPSendKeyDown, RDPSendKeyUp, RDPSendMouseDown, RDPSendMouseUp, RDPSendMouseMove, RDPSendMouseWheel } from '../../wailsjs/go/main/App'

interface FrameChunk {
  x: number; y: number; w: number; h: number; data: string // base64 PNG data:image/png;base64,...
}

interface Props {
  connId: string
  onDisconnect: (connId: string) => void
}

// Keep a cache of loaded images for fast rendering
const imageCache = new Map<string, HTMLImageElement>()

export default function RDPViewer({ connId, onDisconnect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const [connected, setConnected] = useState(false)

  const handleFrame = useCallback((data: Uint8Array) => {
    const decoder = new TextDecoder()
    const json = decoder.decode(data)
    try {
      const update = JSON.parse(json)
      const ctx = ctxRef.current
      if (!ctx || !update.chunks) return

      for (const chunk of update.chunks as FrameChunk[]) {
        if (!chunk.data) continue

        // Check cache
        let img = imageCache.get(chunk.data)
        if (img) {
          ctx.drawImage(img, chunk.x, chunk.y, chunk.w, chunk.h)
        } else {
          // Load image
          img = new Image()
          img.src = chunk.data
          img.onload = () => {
            imageCache.set(chunk.data, img!)
            ctx.drawImage(img!, chunk.x, chunk.y, chunk.w, chunk.h)
          }
        }
      }
    } catch (e) {
      console.error('RDP frame parse:', e)
    }
  }, [])

  const handleState = useCallback((state: string) => {
    setConnected(state === 'connected')
  }, [])

  // Mouse handler
  const handleMouse = useCallback((e: React.MouseEvent<HTMLCanvasElement>, event: 'down' | 'up' | 'move') => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = Math.round(e.clientX - rect.left)
    const y = Math.round(e.clientY - rect.top)
    const button = e.button === 0 ? 1 : e.button === 2 ? 2 : e.button === 1 ? 3 : 0

    if (event === 'down') RDPSendMouseDown(connId, button, x, y)
    else if (event === 'up') RDPSendMouseUp(connId, button, x, y)
    else if (event === 'move') RDPSendMouseMove(connId, x, y)
  }, [connId])

  // Keyboard handler
  const handleKey = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>, down: boolean) => {
    const sc = e.keyCode
    const name = e.key
    if (down) RDPSendKeyDown(connId, sc, name)
    else RDPSendKeyUp(connId, sc, name)
    e.preventDefault()
  }, [connId])

  // Wheel handler
  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = Math.round(e.clientX - rect.left)
    const y = Math.round(e.clientY - rect.top)
    const scroll = e.deltaY > 0 ? -1 : 1
    RDPSendMouseWheel(connId, scroll, x, y)
  }, [connId])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    ctxRef.current = canvas.getContext('2d')

    // Clear cache when reconnecting
    imageCache.clear()

    EventsOn('conn:' + connId + ':data', handleFrame)
    EventsOn('conn:' + connId + ':state', handleState)

    return () => {
      EventsOff('conn:' + connId + ':data')
      EventsOff('conn:' + connId + ':state')
      imageCache.clear()
    }
  }, [connId])

  return (
    <div className="flex items-center justify-center h-full bg-[#1a1a2e] overflow-auto">
      <canvas
        ref={canvasRef}
        width={1280}
        height={800}
        className="shadow-2xl"
        tabIndex={0}
        onMouseDown={(e) => handleMouse(e, 'down')}
        onMouseUp={(e) => handleMouse(e, 'up')}
        onMouseMove={(e) => handleMouse(e, 'move')}
        onKeyDown={(e) => handleKey(e, true)}
        onKeyUp={(e) => handleKey(e, false)}
        onWheel={handleWheel}
      />
      {!connected && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <span className="text-white/70 text-sm">Connecting to RDP...</span>
        </div>
      )}
    </div>
  )
}
