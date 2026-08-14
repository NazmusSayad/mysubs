const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const ACTIVITIES = ['connecting', 'requesting usage', 'waiting for response']
const FRAME_INTERVAL_MS = 120
const FRAMES_PER_ACTIVITY = 3
const ESC = String.fromCharCode(27)
const CLEAR_LINE = `\r${ESC}[2K`

export function startProgress(label: string): () => void {
  const startedAt = Date.now()
  let frameIndex = 0

  function draw(): void {
    const frame = FRAMES[frameIndex]
    const activity =
      ACTIVITIES[
        Math.floor(frameIndex / FRAMES_PER_ACTIVITY) % ACTIVITIES.length
      ]
    if (frame === undefined) throw new Error('spinner frame out of range')
    if (activity === undefined) throw new Error('spinner activity out of range')

    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000)
    process.stderr.write(
      `${CLEAR_LINE}${frame} ${activity} ${label} ${String(elapsedSeconds)}s`
    )
    frameIndex = (frameIndex + 1) % FRAMES.length
  }

  draw()
  const timer = setInterval(draw, FRAME_INTERVAL_MS)

  return function stop(): void {
    clearInterval(timer)
    process.stderr.write(CLEAR_LINE)
  }
}
