import type { Firestore } from 'firebase-admin/firestore'
import { addDaysJST } from './reservationSettings'

export type NotificationMode = 'post' | 'comment'
export type RoomSlot = { rooms: string[]; unavailable: string[]; ready: boolean }
export type RoomDay = { slots: Record<string, RoomSlot> }
export type RoomPreferenceConfig = { notificationMode: NotificationMode; fallbackPost: boolean }

export function roomModeRef(db: Firestore, date: string) {
  return db.collection('room_preference_modes').doc(date)
}

export function roomDayRef(db: Firestore, date: string) {
  return db.collection('room_availability').doc(date)
}

export async function isRoomPreferenceEnabled(db: Firestore, date: string): Promise<boolean> {
  const refs = await db.collection('room_preference_modes').listDocuments()
  const latest = refs.filter((ref) => ref.id <= date).sort((a, b) => b.id.localeCompare(a.id))[0]
  return latest ? (await latest.get()).data()?.enabled === true : false
}

export async function getRoomDay(db: Firestore, date: string): Promise<RoomDay> {
  const snap = await roomDayRef(db, date).get()
  const slots = snap.data()?.slots
  return { slots: slots && typeof slots === 'object' ? slots : {} }
}

export function usableRooms(slot?: RoomSlot): string[] {
  if (!slot?.ready) return []
  const blocked = new Set(slot.unavailable ?? [])
  return (slot.rooms ?? []).filter((room) => !blocked.has(room))
}

export function normalizeRoomList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 100 ||
      !value.every((room) => typeof room === 'string' && room.trim().length > 0 && room.trim().length <= 50)) return null
  const rooms = value.map((room: string) => room.trim())
  return new Set(rooms).size === rooms.length ? rooms : null
}

export async function getRoomPreferenceConfig(db: Firestore): Promise<RoomPreferenceConfig> {
  const snap = await db.collection('settings').doc('room-preference').get()
  return {
    notificationMode: snap.data()?.notificationMode === 'comment' ? 'comment' : 'post',
    fallbackPost: snap.data()?.fallbackPost === true,
  }
}

export function minimumModeDate(): string { return addDaysJST(8) }

export type RankedReservation = { id: string; preferredRooms: string[]; lotteryRank: number }
export type RoomAssignment = { id: string; assignedRoom: string | null; waitRank: number | null; lotteryRank: number }

export function assignRooms(ranked: RankedReservation[], rooms: string[]): RoomAssignment[] {
  const free = new Set(rooms)
  let waitRank = 0
  return [...ranked].sort((a, b) => a.lotteryRank - b.lotteryRank).map((reservation) => {
    const assignedRoom = reservation.preferredRooms.find((room) => free.has(room)) ?? null
    if (assignedRoom) free.delete(assignedRoom)
    return {
      id: reservation.id,
      assignedRoom,
      waitRank: assignedRoom ? null : ++waitRank,
      lotteryRank: reservation.lotteryRank,
    }
  })
}
