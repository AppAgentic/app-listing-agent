import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest, NextResponse } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { z } from 'zod'
import { adminDb } from '@/lib/firebase/admin'
import { conciergeLeadStatuses } from '@/lib/concierge'
import { recordConciergeEvent, requireInternalOperator } from '@/lib/concierge-server'

const updateSchema = z.object({
  leadId: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(conciergeLeadStatuses),
  notes: z.string().trim().max(4000).optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
})

const eventForStatus: Partial<Record<(typeof conciergeLeadStatuses)[number], string>> = {
  booked: 'booking_confirmed',
  attended: 'call_attended',
  approved: 'account_approved',
  paid: 'paid',
}
export async function PATCH(request: NextRequest) {
  const operator = await requireInternalOperator()
  if (!operator) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const input = updateSchema.parse(await readBoundedJson(request))
    const leadRef = adminDb.collection('conciergeLeads').doc(input.leadId)
    const lead = await leadRef.get()
    if (!lead.exists) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const data = lead.data()!
    const now = Timestamp.now()
    const update: Record<string, unknown> = {
      status: input.status,
      updatedAt: now,
      lastUpdatedBy: operator.session.userId,
    }
    if (input.notes !== undefined) update.operatorNotes = input.notes
    if (input.scheduledAt !== undefined) {
      update.scheduledAt = input.scheduledAt ? Timestamp.fromDate(new Date(input.scheduledAt)) : FieldValue.delete()
    }
    update[`${input.status}At`] = now

    await leadRef.update(update)

    if (['approved', 'activated'].includes(input.status)) {
      await adminDb.collection('waitlist').doc(input.leadId).set({
        status: 'approved',
        notifiedAt: now,
        updatedAt: now,
      }, { merge: true })
    } else if (input.status === 'paid') {
      await adminDb.collection('waitlist').doc(input.leadId).set({
        status: 'converted',
        convertedAt: now,
        updatedAt: now,
      }, { merge: true })
    }

    const eventName = eventForStatus[input.status]
    if (eventName) {
      await recordConciergeEvent({
        name: eventName,
        leadId: input.leadId,
        source: 'operator_queue',
        metadata: { previousStatus: typeof data.status === 'string' ? data.status : 'unknown' },
      })
    }

    return NextResponse.json({ success: true, status: input.status })
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error && typeof error === 'object' && 'issues' in error) {
      return NextResponse.json({ error: 'validation_error' }, { status: 400 })
    }
    console.error('Concierge lead update failed:', error)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
