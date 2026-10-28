import Skeleton from '../../components/Skeleton'

export const scheduleToolbarClass = 'flex items-center gap-1.5 mb-2 flex-wrap relative'
export const scheduleGridClass = 'border border-line rounded-xl shadow-[var(--shadow-card-sm)] overflow-hidden flex flex-col flex-1 min-h-0 transition-[margin] duration-200'

export default function ScheduleLoading({ fullPage = false, height = 840 }: { fullPage?: boolean; height?: number }) {
  const hourCount = Math.ceil(height / 60) + 1
  const grid = (
    <div className={scheduleGridClass} aria-label="予定表を読み込み中">
      <div className="overflow-y-auto flex-1 min-h-0" style={{ scrollbarGutter: 'stable' }}>
        <div className="sticky top-0 z-20 bg-surface border-b border-line flex">
          <div className="w-9 flex-shrink-0" />
          <div className="flex-1 relative flex" style={{ overflow: 'clip' }}>
            {Array.from({ length: 7 }, (_, i) => <div key={i} className="flex-1 text-center py-1.5 border-l border-line text-[0.67rem] font-semibold leading-tight"><Skeleton width="70%" height={12} className="mx-auto mb-1" /><Skeleton width="40%" height={10} className="mx-auto" /></div>)}
          </div>
        </div>
        <div className="flex overflow-hidden" style={{ height }}>
          <div className="w-9 flex-shrink-0 relative">
            {Array.from({ length: hourCount }, (_, i) => <Skeleton key={i} width={22} height={9} className="absolute right-1" style={{ top: i * 60 + 4 }} />)}
          </div>
          <div className="flex-1 relative flex" style={{ overflow: 'clip' }}>
            {Array.from({ length: 7 }, (_, i) => <div key={i} className="flex-1 relative border-l border-line min-w-0 overflow-hidden">
              {Array.from({ length: hourCount }, (_, hour) => <div key={hour} className="absolute left-0 right-0 border-t border-line" style={{ top: hour * 60 }} />)}
              <Skeleton width="85%" height={74} className="absolute left-[7%] top-[64px]" />
              <Skeleton width="85%" height={50} className="absolute left-[7%] top-[244px]" />
            </div>)}
          </div>
        </div>
      </div>
    </div>
  )

  if (!fullPage) return grid
  return <div className="flex flex-col flex-1 min-h-0">
    <div className={scheduleToolbarClass}>
      <Skeleton width={36} height={36} /><Skeleton width={36} height={36} />
      <Skeleton width={108} height={18} /><Skeleton width={36} height={36} /><Skeleton width={48} height={32} />
    </div>
    <p className="text-[0.75rem] text-ink-pale mb-2 flex items-center gap-1"><Skeleton width={180} height={14} /></p>
    {grid}
  </div>
}
