interface PackageItem {
  dir: string
  count: number
}

interface Props {
  items: PackageItem[]
  active: Set<string>
  onToggle: (dir: string) => void
  onClear: () => void
  className?: string
}

export default function PackageFilter({
  items,
  active,
  onToggle,
  onClear,
  className = '',
}: Props) {
  if (items.length === 0) return null
  return (
    <div className={`pkg-filter ${className}`}>
      {items.map((item) => (
        <button
          key={item.dir}
          className={`chip pkg-chip ${active.has(item.dir) ? 'chip-active' : ''}`}
          onClick={() => onToggle(item.dir)}
          title={`${item.dir} (${item.count} entities)`}
        >
          <span className="pkg-chip-dir">{item.dir}</span>{' '}
          <span className="muted">{item.count}</span>
        </button>
      ))}
      {active.size > 0 ? (
        <button className="chip pkg-chip pkg-chip-clear" onClick={onClear}>
          clear
        </button>
      ) : null}
    </div>
  )
}
