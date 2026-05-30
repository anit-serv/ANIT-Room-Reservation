export type PopoverPosition = {
  top: number
  left: number
}

type Options = {
  width?: number
  height?: number
  gap?: number
  margin?: number
}

export function getCalendarPopoverPosition(anchor: HTMLElement, options: Options = {}): PopoverPosition {
  const width = options.width ?? 252
  const height = options.height ?? 292
  const gap = options.gap ?? 6
  const margin = options.margin ?? 8
  const rect = anchor.getBoundingClientRect()

  const maxLeft = Math.max(margin, window.innerWidth - width - margin)
  const left = Math.min(Math.max(margin, rect.left), maxLeft)
  const belowTop = rect.bottom + gap
  const aboveTop = rect.top - height - gap
  const fitsBelow = belowTop + height <= window.innerHeight - margin
  const top = fitsBelow ? belowTop : Math.max(margin, aboveTop)

  return { top, left }
}
