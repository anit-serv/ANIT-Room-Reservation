export default function RoomPreferenceSettings({ enabled, onEnabledChange, mode, onModeChange, fallback, onFallbackChange, commentConfigured }: {
  enabled: boolean; onEnabledChange: (enabled: boolean) => void
  mode: 'post' | 'comment'; onModeChange: (mode: 'post' | 'comment') => void
  fallback: boolean; onFallbackChange: (fallback: boolean) => void; commentConfigured: boolean
}) {
  return <div className="space-y-4 mb-6">
    <section className="admin-card">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-bold mb-1">希望部屋モード</h2>
          <p className="text-[0.85rem] text-ink-sub">指定した適用日から、予約時に希望部屋を選べるようにします。</p>
        </div>
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <span className="text-sm font-semibold">{enabled ? 'オン' : 'オフ'}</span>
          <input type="checkbox" role="switch" aria-label="希望部屋モード" checked={enabled}
            onChange={(event) => onEnabledChange(event.target.checked)}
            className="sr-only peer" />
          <span aria-hidden="true" className="relative w-11 h-6 rounded-full bg-line peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand transition-colors after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5" />
        </label>
      </div>
      <p className="text-[0.82rem] text-ink-sub mt-3">画面下部の「適用日」と「確認する」から、他の設定と一緒に保存します。</p>
    </section>
    <section className="admin-card">
      <h2 className="font-bold mb-3">BAND通知方式</h2>
      <label className="block text-sm mb-3">方式<select className="text-input mt-1" value={mode}
        onChange={(event) => onModeChange(event.target.value as 'post' | 'comment')}>
        <option value="post">投稿先BANDに新規投稿</option><option value="comment">コメント先BANDでメンション投稿にコメント</option>
      </select></label>
      {mode === 'comment' && <><p className="text-sm text-ink-sub mb-2">コメント先BAND: {commentConfigured ? '設定済み' : '未設定'}</p>
        <label className="flex items-center gap-2 text-sm mb-3"><input type="checkbox" checked={fallback}
          onChange={(event) => onFallbackChange(event.target.checked)} />1時間以内に対象投稿がなければ投稿先BANDに自動投稿</label></>}
      <p className="text-[0.82rem] text-ink-sub">画面下部の「適用日」と「確認する」から保存します。適用日以降の利用日分の通知に反映します。</p>
    </section>
  </div>
}
