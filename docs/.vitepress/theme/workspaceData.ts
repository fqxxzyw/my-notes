/** Conservatively recognize workspace records before an import can replace them. */
export function hasUserData(key: string, value: string): boolean {
  if (key.startsWith('paper-notes-draft:') || key.includes(':paper-notes-draft:')) return true
  try {
    const data = JSON.parse(value)
    if (key === 'paper-notes:cabinets:v1' || key.endsWith(':paper-notes:cabinets:v1')) {
      return ['created', 'moves', 'removed', 'renamed'].some(field => Object.keys(data?.[field] || {}).length > 0)
    }
    return (Array.isArray(data?.books) && data.books.length > 0) ||
      (Array.isArray(data?.chapters) && data.chapters.length > 0) ||
      Object.keys(data?.synced || {}).length > 0 ||
      Object.keys(data?.bookDescriptionDrafts || {}).length > 0
  } catch { return true }
}
