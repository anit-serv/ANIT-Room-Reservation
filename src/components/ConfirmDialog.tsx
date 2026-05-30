import { useState } from 'react'

type Props = {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  onClose: () => void
  onConfirm: () => Promise<void>
}

export default function ConfirmDialog({ title, message, confirmLabel = '削除', cancelLabel = 'キャンセル', onClose, onConfirm }: Props) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function handleConfirm() {
    setLoading(true)
    setError(null)
    try {
      await onConfirm()
    } catch (err: any) {
      setError(err.message ?? '失敗しました')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={() => !loading && onClose()} />
      <div className="relative bg-surface rounded-2xl shadow-[var(--shadow-modal)] w-full max-w-[320px] p-6">
        <p className="text-base font-bold text-ink mb-1.5">{title}</p>
        <p className="text-[0.85rem] text-ink-sub mb-4">{message}</p>
        {error && <div className="banner-error mb-3">{error}</div>}
        <div className="flex gap-2">
          <button className="btn-secondary flex-1 whitespace-nowrap" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </button>
          <button className="btn-danger flex-1 whitespace-nowrap" onClick={handleConfirm} disabled={loading}>
            {loading ? '処理中...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
