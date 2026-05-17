import type { CSSProperties } from 'react'

type Props = {
  width?: string | number
  height?: string | number
  circle?: boolean
  style?: CSSProperties
  className?: string
}

export default function Skeleton({ width, height, circle, style, className = '' }: Props) {
  return (
    <div
      className={`skel ${circle ? 'skel-circle' : ''} ${className}`.trim()}
      style={{ width, height, ...style }}
    />
  )
}
