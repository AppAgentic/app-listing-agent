import { randomUUID } from 'crypto'
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '../firebase/admin'
import { normalizeIconStyle, type IconStyle } from '../constants'
import type { GeneratedIcon } from './icon-generator'
/** The same collection shape is used by /api/icons/list for dashboard and MCP results. */
export async function saveIconRecord(icon: GeneratedIcon, options: { userId: string; orgId?: string; projectId: string; style?: IconStyle; prompt?: string }) {
  if (!icon.success) throw new Error('Cannot save a failed icon')
  const id = `icon-${randomUUID()}`
  const owner = options.orgId ? adminDb.collection('organizations').doc(options.orgId) : adminDb.collection('users').doc(options.userId)
  await owner.collection('projects').doc(options.projectId).collection('icons').doc(id).set({
    id, originalUrl: icon.originalUrl, ios: icon.ios, android: icon.android,
    style: options.style ? normalizeIconStyle(options.style) : null, prompt: options.prompt || null,
    createdAt: Timestamp.now(), createdBy: options.userId,
  })
  return id
}
