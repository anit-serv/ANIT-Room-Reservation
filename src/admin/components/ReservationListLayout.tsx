import type { ReactNode } from 'react'

type Variant = 'nobu' | 'room'

export const reservationMobileRowClass = 'border-b border-line last:border-b-0'
export const reservationMobileTriggerClass = 'w-full flex items-center gap-3 px-4 py-3 text-left bg-transparent border-0 cursor-pointer hover:bg-[#fafbfc] transition-colors'
export const reservationMobileDateClass = 'bg-bg px-4 py-2 text-[0.82rem] font-bold text-ink-sub border-b border-line'

const columns: Record<Variant, { title: string; width?: string }[]> = {
  nobu: [
    { title: '時間', width: '150px' }, { title: 'バンド名' }, { title: '登録者', width: '200px' },
    { title: 'ステータス', width: '130px' }, { title: '順位', width: '70px' }, { title: '操作', width: '100px' },
  ],
  room: [
    { title: '時間帯', width: '180px' }, { title: 'バンド名' }, { title: '登録者', width: '220px' }, { title: '操作', width: '100px' },
  ],
}

export function ReservationTableColumns({ variant }: { variant: Variant }) {
  return <>
    <colgroup>{columns[variant].map((column) => <col key={column.title} style={column.width ? { width: column.width } : undefined} />)}</colgroup>
    <thead><tr>{columns[variant].map((column) => <th key={column.title} className={variant === 'nobu' && (column.title === 'ステータス' || column.title === '順位') ? 'text-right' : undefined}>{column.title}</th>)}</tr></thead>
  </>
}

export function ReservationDateHeader({ label, count, headerRef }: { label: string; count: number; headerRef?: (el: HTMLDivElement | null) => void }) {
  return <div ref={headerRef} className="flex items-center justify-between px-5 py-3 bg-bg border-b border-line">
    <div className="flex items-center gap-2 font-bold text-ink">
      <span className="icon icon-sm text-ink-pale">event</span>{label}
    </div>
    <span className="text-[0.78rem] font-semibold text-ink-sub">{count}件</span>
  </div>
}

export function ReservationDesktopGroup({ variant, label, count, headerRef, children }: { variant: Variant; label: string; count: number; headerRef?: (el: HTMLDivElement | null) => void; children: ReactNode }) {
  return <section className="bg-surface border border-line rounded-xl overflow-hidden shadow-[var(--shadow-card-sm)]">
    <ReservationDateHeader label={label} count={count} headerRef={headerRef} />
    <table className="admin-table" style={{ tableLayout: 'fixed', width: '100%' }}>
      <ReservationTableColumns variant={variant} />
      <tbody>{children}</tbody>
    </table>
  </section>
}

