import { useEffect, useRef, useCallback } from 'react'
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime'
import { VNCSendPointer, VNCSendKey, VNCRequestUpdate, VNCSendClipboard } from '../../wailsjs/go/main/App'

interface FrameRect {
  X: number; Y: number; Width: number; Height: number
  EncType: number; Data: Uint8Array | null
}

interface FrameUpdate {
  Rects: FrameRect[]
}

interface Props {
  connId: string
  onDisconnect: (connId: string) => void
}

export default function VNCViewer({ connId, onDisconnect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const frameBufRef = useRef<ImageData | null>(null)
  const sizeRef = useRef({ w: 800, h: 600 })

  // Handle framebuffer updates from Go backend
  const handleFrame = useCallback((data: Uint8Array) => {
    const decoder = new TextDecoder()
    const json = decoder.decode(data)
    try {
      const update: FrameUpdate = JSON.parse(json)
      const ctx = ctxRef.current
      if (!ctx) return

      for (const rect of update.Rects) {
        const data = rect.Data ? new Uint8Array(rect.Data) : null
        switch (rect.EncType) {
          case 0: // Raw - BGRA pixel data
            if (data) {
              const imgData = new ImageData(rect.Width, rect.Height)
              // Convert BGRA to RGBA
              for (let i = 0; i < data.length; i += 4) {
                imgData.data[i] = data[i + 2]     // R from B
                imgData.data[i + 1] = data[i + 1] // G
                imgData.data[i + 2] = data[i]     // B from R
                imgData.data[i + 3] = data[i + 3] // A
              }
              ctx.putImageData(imgData, rect.X, rect.Y)
            }
            break
          case 1: // CopyRect
            if (data) {
              const srcX = (data[0] << 8) | data[1]
              const srcY = (data[2] << 8) | data[3]
              const imgData = ctx.getImageData(srcX, srcY, rect.Width, rect.Height)
              ctx.putImageData(imgData, rect.X, rect.Y)
            }
            break
          // Hextile, Tight etc. handled in Go, arrive as Raw data
        }
      }
    } catch (e) {
      console.error('VNC frame parse:', e)
    }
  }, [])

  // Handle mouse events
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const scaleX = sizeRef.current.w / rect.width
    const scaleY = sizeRef.current.h / rect.height
    const x = Math.round((e.clientX - rect.left) * scaleX)
    const y = Math.round((e.clientY - rect.top) * scaleY)
    const buttons = e.buttons  // 1=left, 2=middle, 4=right
    VNCSendPointer(connId, x, y, buttons)
  }, [connId])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    handleMouseMove(e)
  }, [handleMouseMove])

  // Handle keyboard events
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const keySym = e.key.charCodeAt(0) || e.keyCode
    VNCSendKey(connId, true, keySym)
    e.preventDefault()
  }, [connId])

  const handleKeyUp = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const keySym = e.key.charCodeAt(0) || e.keyCode
    VNCSendKey(connId, false, keySym)
  }, [connId])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    ctxRef.current = canvas.getContext('2d')

    // Set initial canvas size
    canvas.width = sizeRef.current.w
    canvas.height = sizeRef.current.h

    // Listen for frame updates from Go
    EventsOn('conn:' + connId + ':data', handleFrame)

    // Listen for remote clipboard (ServerCutText)
    EventsOn('conn:' + connId + ':clipboard', (text: string) => {
      navigator.clipboard.writeText(text).catch(() => {})
    })

    // Handle paste (local → remote)
    const handlePaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text')
      if (text) VNCSendClipboard(connId, text)
    }
    canvas.addEventListener('paste', handlePaste)
    canvas.focus()

    // Request initial full update
    VNCRequestUpdate(connId)

    return () => {
      EventsOff('conn:' + connId + ':data')
      EventsOff('conn:' + connId + ':clipboard')
      canvas.removeEventListener('paste', handlePaste)
    }
  }, [connId])

  return (
    <div className="flex items-center justify-center h-full bg-bg-primary overflow-auto">
      <canvas
        ref={canvasRef}
        className="max-w-full max-h-full object-contain"
        style={{ imageRendering: 'pixelated' }}
        tabIndex={0}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseMove}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
      />
    </div>
  )
}
