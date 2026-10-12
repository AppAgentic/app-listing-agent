import { onSchedule } from "firebase-functions/v2/scheduler"
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore"

const db = getFirestore()
const USAGE_TYPES = new Set(["translations", "screenshots", "icons", "publishing", "apps"])

async function reconcileExpiredReservation(eventRef: FirebaseFirestore.DocumentReference): Promise<boolean> {
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(eventRef)
    if (!snapshot.exists) return false
    const event = snapshot.data() || {}
    if (event.status !== "reserved") return false
    if (!event.expiresAt?.toMillis || event.expiresAt.toMillis() > Date.now()) return false
    if (!USAGE_TYPES.has(event.usageType)) {
      throw new Error(`Invalid usage type on reservation ${eventRef.path}`)
    }

    const accountRef = eventRef.parent.parent
    if (!accountRef) throw new Error(`Usage reservation has no account root: ${eventRef.path}`)
    const summaryRef = accountRef.collection("usage").doc(String(event.periodKey))
    const now = Timestamp.now()
    const projectPath = event.metadata?.route === "projects-create" && typeof event.metadata?.projectPath === "string"
      ? event.metadata.projectPath
      : null
    const projectExists = projectPath
      ? (await transaction.get(db.doc(projectPath))).exists
      : false
    const settledUnits = projectExists ? Number(event.reservedUnits || 0) : 0

    transaction.update(eventRef, {
      status: projectExists ? "settled" : "refunded",
      settledUnits,
      ...(projectExists
        ? { settlementReason: "project_exists", settledAt: now }
        : { refundReason: "reservation_expired", refundedAt: now }),
      updatedAt: now,
    })
    transaction.set(summaryRef, {
      [`${event.usageType}Reserved`]: FieldValue.increment(-Number(event.reservedUnits || 0)),
      ...(settledUnits > 0
        ? { [`${event.usageType}Used`]: FieldValue.increment(settledUnits) }
        : {}),
      updatedAt: now,
    }, { merge: true })
    return true
  })
}

export const reconcileExpiredUsageReservations = onSchedule(
  {
    schedule: "every 60 minutes",
    timeZone: "UTC",
    retryCount: 3,
    timeoutSeconds: 300,
    memory: "256MiB",
  },
  async () => {
    const expired = await db.collectionGroup("usageEvents")
      .where("status", "==", "reserved")
      .where("expiresAt", "<=", Timestamp.now())
      .limit(500)
      .get()

    let reconciled = 0
    for (let index = 0; index < expired.docs.length; index += 25) {
      const results = await Promise.all(
        expired.docs.slice(index, index + 25).map(doc => reconcileExpiredReservation(doc.ref))
      )
      reconciled += results.filter(Boolean).length
    }

    console.log(`Reconciled ${reconciled} expired usage reservation(s)`)
  }
)
