import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  ASC_SLOT_ACCEPTED_SIZES,
  DEFAULT_ASC_SLOT,
  assignAscSlots,
  slotAcceptsSize,
  sortByPosition,
} from '../lib/services/asc-screenshot-slots'
import { buildCatalog, groupForLegacyDisplayType } from '../lib/services/asc-asset-library'

const refData = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/asc-asset-library-refdata.json'), 'utf8'))
const catalog = buildCatalog(refData.data[0].attributes)

describe('assignAscSlots', () => {
  it('maps a single device type to its default slot', () => {
    expect(assignAscSlots(['APP_IPHONE_69', 'APP_IPAD_PRO_13'])).toEqual({
      slots: { APP_IPHONE_69: 'APP_IPHONE_67', APP_IPAD_PRO_13: 'APP_IPAD_PRO_3GEN_129' },
      skipped: [],
    })
    expect(assignAscSlots(['APP_IPHONE_61']).slots).toEqual({ APP_IPHONE_61: 'APP_IPHONE_61' })
    expect(assignAscSlots(['APP_IPAD_PRO_129']).slots).toEqual({ APP_IPAD_PRO_129: 'APP_IPAD_PRO_3GEN_129' })
  })

  it('moves the second device of a pair to its own slot instead of overwriting', () => {
    // Firestore returns docs alphabetically, so 61 comes before 63 and 129 before 13
    const { slots, skipped } = assignAscSlots(['APP_IPAD_PRO_129', 'APP_IPAD_PRO_13', 'APP_IPHONE_61', 'APP_IPHONE_63'])
    expect(slots).toEqual({
      APP_IPHONE_63: 'APP_IPHONE_61',
      APP_IPHONE_61: 'APP_IPHONE_58',
      APP_IPAD_PRO_13: 'APP_IPAD_PRO_3GEN_129',
      APP_IPAD_PRO_129: 'APP_IPAD_PRO_129',
    })
    expect(skipped).toEqual([])
    expect(new Set(Object.values(slots)).size).toBe(4)
  })

  it('skips a device whose slot is taken and has no alternative', () => {
    const { slots, skipped } = assignAscSlots(['APP_IPHONE_67', 'APP_IPHONE_69'])
    expect(slots).toEqual({ APP_IPHONE_69: 'APP_IPHONE_67' })
    expect(skipped).toEqual([{ displayType: 'APP_IPHONE_67', ascDisplayType: 'APP_IPHONE_67', keptDisplayType: 'APP_IPHONE_69' }])
  })

  it('passes unknown types through unchanged', () => {
    expect(assignAscSlots(['APP_IPHONE_47']).slots).toEqual({ APP_IPHONE_47: 'APP_IPHONE_47' })
  })
})

describe('slotAcceptsSize', () => {
  it('accepts our generator sizes natively', () => {
    expect(slotAcceptsSize('APP_IPHONE_67', 1260, 2736)).toBe(true) // our 6.9"
    expect(slotAcceptsSize('APP_IPHONE_67', 2736, 1260)).toBe(true) // landscape
    expect(slotAcceptsSize('APP_IPHONE_61', 1206, 2622)).toBe(true) // our 6.3"
    expect(slotAcceptsSize('APP_IPHONE_58', 1170, 2532)).toBe(true) // our 6.1"
    expect(slotAcceptsSize('APP_IPAD_PRO_3GEN_129', 2064, 2752)).toBe(true) // our 13"
  })

  it('rejects sizes from another class', () => {
    expect(slotAcceptsSize('APP_IPHONE_61', 1170, 2532)).toBe(false)
    expect(slotAcceptsSize('APP_IPAD_PRO_129', 2064, 2752)).toBe(false)
    expect(slotAcceptsSize('UNKNOWN', 100, 100)).toBe(false)
  })

  it("matches Apple's reference data for every slot", () => {
    const specs = new Map<string, { minWidth: number; minHeight: number }>()
    for (const s of refData.data[0].attributes.imageSpecs) specs.set(s.specId, s.dimensions)
    const screenshotType = refData.data[0].attributes.placementTypes.find((t: { placementTypeId: string }) => t.placementTypeId === 'APP_SCREENSHOT')
    for (const [slot, sizes] of Object.entries(ASC_SLOT_ACCEPTED_SIZES)) {
      const group = groupForLegacyDisplayType(catalog, slot)
      expect(group, slot).toBeTruthy()
      const mapping = screenshotType.specMappings.find((m: { placementGroupId: string }) => m.placementGroupId === group)
      const apple = new Set<string>(mapping.specs.map((id: string) => {
        const d = specs.get(id)!
        return `${Math.min(d.minWidth, d.minHeight)}x${Math.max(d.minWidth, d.minHeight)}`
      }))
      expect([...apple].sort(), slot).toEqual([...sizes].sort())
    }
  })

  it('has accepted sizes for every default slot', () => {
    for (const slot of Object.values(DEFAULT_ASC_SLOT)) expect(ASC_SLOT_ACCEPTED_SIZES[slot], slot).toBeDefined()
  })
})

describe('sortByPosition', () => {
  it('orders by position without mutating the input', () => {
    const input = [{ id: 'c', position: 2 }, { id: 'a', position: 0 }, { id: 'b', position: 1 }]
    expect(sortByPosition(input).map(s => s.id)).toEqual(['a', 'b', 'c'])
    expect(input[0].id).toBe('c')
  })
})

describe('functions mirror', () => {
  it('functions/src/ascScreenshotSlots.ts is identical to lib/services/asc-screenshot-slots.ts', () => {
    const root = path.join(__dirname, '..')
    expect(readFileSync(path.join(root, 'functions/src/ascScreenshotSlots.ts'), 'utf8'))
      .toBe(readFileSync(path.join(root, 'lib/services/asc-screenshot-slots.ts'), 'utf8'))
  })
})
