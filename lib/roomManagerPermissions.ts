export function roomManagerIds(data: Record<string, any> | undefined): string[] {
  if (Array.isArray(data?.userIds)) {
    return [...new Set(data.userIds.filter((id: unknown): id is string => typeof id === 'string' && !!id))]
  }
  return typeof data?.userId === 'string' && data.userId ? [data.userId] : []
}

export function roomManagerUpdate(ids: string[], updatedBy: string) {
  return { userIds: ids, userId: ids[0] ?? null, updatedAt: new Date(), updatedBy }
}
