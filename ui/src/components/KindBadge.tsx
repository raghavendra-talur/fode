const SHORT: Record<string, string> = {
  function: 'fn',
  method: 'me',
  struct: 'st',
  interface: 'if',
  type: 'ty',
  const: 'co',
  var: 'va',
}

export default function KindBadge({ kind }: { kind: string }) {
  return (
    <span className={`kind-badge kind-${kind}`} title={kind}>
      {SHORT[kind] ?? kind.slice(0, 2)}
    </span>
  )
}
