import { useState, useEffect, useCallback } from 'react'
import { Minus, Square, X, Copy } from 'lucide-react'
import {
  WindowMinimise,
  WindowToggleMaximise,
  WindowIsMaximised,
  Quit,
} from '../../wailsjs/runtime/runtime'
import logoImg from '../assets/images/logo-universal.png'

export default function TitleBar() {
  const [isMaximised, setIsMaximised] = useState(false)

  useEffect(() => {
    WindowIsMaximised().then(setIsMaximised)
  }, [])

  // Sync maximize state on window resize (handles Win+Up/Down etc.)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const onResize = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        WindowIsMaximised().then(setIsMaximised)
      }, 200)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      clearTimeout(timer)
    }
  }, [])

  const handleMinimize = useCallback(() => WindowMinimise(), [])
  const handleToggleMaximise = useCallback(() => {
    WindowToggleMaximise()
    setIsMaximised(v => !v)
  }, [])
  const handleClose = useCallback(() => Quit(), [])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 32,
        flexShrink: 0,
        background: '#1a1a1c',
        borderBottom: '1px solid #2d2d2d',
        userSelect: 'none',
        '--wails-draggable': 'drag',
        paddingLeft: 2,
        paddingRight: 2,
      } as React.CSSProperties}
    >
      {/* Logo + App name — draggable */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        paddingLeft: 10,
        paddingRight: 16,
        height: '100%',
      }}>
        <img src={logoImg} alt="" style={{ width: 16, height: 16 }} />
        <span style={{
          fontSize: 12,
          fontWeight: 600,
          color: '#cccccc',
          letterSpacing: 0.3,
        }}>
          OmniMind
        </span>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Window controls — not draggable */}
      <div style={{
        display: 'flex',
        height: '100%',
        '--wails-draggable': 'no-drag',
      } as React.CSSProperties}>
        <TitleBarButton onClick={handleMinimize} title="Minimize">
          <Minus size={14} />
        </TitleBarButton>
        <TitleBarButton onClick={handleToggleMaximise} title={isMaximised ? 'Restore' : 'Maximize'}>
          {isMaximised ? <Copy size={12} /> : <Square size={12} />}
        </TitleBarButton>
        <TitleBarButton onClick={handleClose} title="Close" isClose>
          <X size={15} />
        </TitleBarButton>
      </div>
    </div>
  )
}

function TitleBarButton({
  onClick,
  title,
  children,
  isClose,
}: {
  onClick: () => void
  title: string
  children: React.ReactNode
  isClose?: boolean
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 46,
        height: '100%',
        border: 'none',
        outline: 'none',
        cursor: 'pointer',
        color: hovered ? '#ffffff' : '#999999',
        background: hovered
          ? (isClose ? '#e81123' : 'rgba(255,255,255,0.08)')
          : 'transparent',
        transition: 'background 0.15s, color 0.15s',
        borderRadius: 6,
      }}
    >
      {children}
    </button>
  )
}
