// Shared group system used by both devices and commands
export interface Group { id: string; name: string; parentId: string }

function genId() { return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 8) }

const DEFAULT_GROUP: Group = { id: 'default', name: '默认', parentId: '' }

function load(): Group[] {
  try {
    const d = localStorage.getItem('omni-groups')
    const groups: Group[] = d ? JSON.parse(d) : []
    if (!groups.find(g => g.id === 'default')) groups.unshift(DEFAULT_GROUP)
    return groups
  } catch { return [DEFAULT_GROUP] }
}
function save(g: Group[]) { localStorage.setItem('omni-groups', JSON.stringify(g)) }

export function useGroups(): [Group[], (g: Group[]) => void] {
  return [load(), save]
}

export function getGroupTree(groups: Group[]) {
  const roots = groups.filter(g => !g.parentId)
  const children = (parentId: string) => groups.filter(g => g.parentId === parentId)
  return { roots, children }
}

export function getGroupPath(groups: Group[], groupId: string): string {
  const parts: string[] = []
  let current = groups.find(g => g.id === groupId)
  while (current) {
    parts.unshift(current.name)
    current = groups.find(g => g.id === current!.parentId)
  }
  return parts.join(' > ')
}

export { genId, DEFAULT_GROUP }
