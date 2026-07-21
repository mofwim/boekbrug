'use client'

import { useEffect, useRef, useState } from 'react'

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [score, setScore] = useState(0)
  const [gameOver, setGameOver] = useState(false)
  const gameRef = useRef({
    playerY: 150,
    playerVelocity: 0,
    playerSize: 20,
    pipes: [] as Array<{ x: number; gap: number }>,
    score: 0,
    gameRunning: false,
    lastPipeTime: 0,
  })

  const gravity = 0.5
  const jumpPower = -12
  const pipeWidth = 60
  const gapSize = 100
  const pipeSpacing = 180

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const game = gameRef.current
    const width = canvas.width
    const height = canvas.height
    let animationId: number

    const startGame = () => {
      game.playerY = height / 2
      game.playerVelocity = 0
      game.pipes = []
      game.score = 0
      game.gameRunning = true
      game.lastPipeTime = 0
      setGameOver(false)
      setScore(0)
    }

    const handleInput = () => {
      if (!game.gameRunning) {
        startGame()
      } else {
        game.playerVelocity = jumpPower
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        handleInput()
      }
    }

    canvas.addEventListener('click', handleInput)
    window.addEventListener('keydown', handleKeyDown)

    const animate = () => {
      if (!game.gameRunning) {
        ctx.fillStyle = '#1a1a2e'
        ctx.fillRect(0, 0, width, height)
        ctx.fillStyle = '#fff'
        ctx.font = '24px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('PIPE DODGE', width / 2, height / 2 - 40)
        ctx.font = '18px sans-serif'
        ctx.fillText('Click or Space to Start', width / 2, height / 2)
        ctx.fillText(`Best: ${game.score}`, width / 2, height / 2 + 40)
        animationId = requestAnimationFrame(animate)
        return
      }

      // Physics
      game.playerVelocity += gravity
      game.playerY += game.playerVelocity

      // Spawn pipes
      const now = Date.now()
      if (now - game.lastPipeTime > 2000) {
        const minGap = 80
        const maxGap = height - gapSize - 100
        const gapPos = minGap + Math.random() * (maxGap - minGap)
        game.pipes.push({ x: width, gap: gapPos })
        game.lastPipeTime = now
      }

      // Move pipes
      game.pipes = game.pipes
        .map((p) => ({ ...p, x: p.x - 5 }))
        .filter((p) => p.x > -pipeWidth)

      // Score & collision
      for (const pipe of game.pipes) {
        if (
          pipe.x < 30 + game.playerSize / 2 &&
          pipe.x + pipeWidth > 30
        ) {
          if (
            game.playerY - game.playerSize / 2 < pipe.gap ||
            game.playerY + game.playerSize / 2 > pipe.gap + gapSize
          ) {
            game.gameRunning = false
            setGameOver(true)
            return
          }
          if (pipe.x === 30) {
            game.score++
            setScore(game.score)
          }
        }
      }

      // Bounds
      if (game.playerY - game.playerSize / 2 < 0 || game.playerY + game.playerSize / 2 > height) {
        game.gameRunning = false
        setGameOver(true)
        return
      }

      // Draw
      ctx.fillStyle = '#1a1a2e'
      ctx.fillRect(0, 0, width, height)

      // Player
      ctx.fillStyle = '#00d4ff'
      ctx.fillRect(
        30 - game.playerSize / 2,
        game.playerY - game.playerSize / 2,
        game.playerSize,
        game.playerSize
      )

      // Pipes
      ctx.fillStyle = '#ff6b6b'
      for (const pipe of game.pipes) {
        ctx.fillRect(pipe.x, 0, pipeWidth, pipe.gap)
        ctx.fillRect(pipe.x, pipe.gap + gapSize, pipeWidth, height)
      }

      // Score
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 24px sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(`${score}`, 20, 40)

      animationId = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      cancelAnimationFrame(animationId)
      canvas.removeEventListener('click', handleInput)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [score])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f0f1e', fontFamily: 'system-ui' }}>
      <canvas
        ref={canvasRef}
        width={400}
        height={600}
        style={{ border: '2px solid #00d4ff', display: 'block', imageRendering: 'pixelated' }}
      />
      {gameOver && (
        <div style={{ marginTop: 20, textAlign: 'center', color: '#fff' }}>
          <div style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 10 }}>GAME OVER</div>
          <div style={{ fontSize: 18, marginBottom: 10 }}>Score: {score}</div>
          <div style={{ fontSize: 14, color: '#888' }}>Click canvas or press Space</div>
        </div>
      )}
    </div>
  )
}
