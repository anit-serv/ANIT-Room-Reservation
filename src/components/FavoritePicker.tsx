export type Favorite = {
  id:           string
  name:         string
  nobuTimeSlot: string | null
}

export default function FavoritePicker({
  favorites,
  onSelect,
}: {
  favorites:  Favorite[]
  onSelect:   (favoriteId: string, name: string, nobuTimeSlot: string | null) => void
}) {
  if (favorites.length === 0) return null
  return (
    <div className="mb-2">
      <p className="text-[0.72rem] text-ink-pale mb-1.5">お気に入りから選択</p>
      <div className="flex gap-1.5 flex-wrap">
        {favorites.map(f => (
          <button
            key={f.id}
            type="button"
            className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-brand-light border border-brand/30 text-[0.78rem] text-brand-dark font-medium active:scale-95 transition"
            onClick={() => onSelect(f.id, f.name, f.nobuTimeSlot)}
          >
            <span className="icon" style={{ fontSize: 13 }}>star</span>
            {f.name}
          </button>
        ))}
      </div>
    </div>
  )
}
