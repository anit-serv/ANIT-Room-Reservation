import { useEffect, useState } from 'react'

type Props = {
  message: string
  onClose: () => void
}

export default function Toast({ message, onClose }: Props) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const fadeTimer  = setTimeout(() => setVisible(false), 2000)
    const closeTimer = setTimeout(onClose, 2600)
    return () => { clearTimeout(fadeTimer); clearTimeout(closeTimer) }
  }, [onClose])

  return (
    <div
      className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-2 bg-[#1a1a1a] text-white px-5 py-3 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.25)] text-[0.9rem] font-medium pointer-events-none transition-opacity duration-500 whitespace-nowrap ${visible ? 'opacity-100' : 'opacity-0'}`}
    >
      <span className="icon text-brand" style={{ fontSize: 20 }}>check_circle</span>
      {message}
    </div>
  )
}
