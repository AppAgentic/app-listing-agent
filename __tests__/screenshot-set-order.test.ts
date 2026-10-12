import { describe, expect, it } from 'vitest'
import { existingSetMatchesInOrder } from '../functions/src/screenshotSetMatch'

const item = (checksum: string, state = 'COMPLETE') => ({
  attributes: { sourceFileChecksum: checksum, assetDeliveryState: { state } },
})

describe('existingSetMatchesInOrder', () => {
  it('skips when the same files are already in the same order', () => {
    expect(existingSetMatchesInOrder([item('a'), item('b'), item('c')], ['a', 'b', 'c'])).toBe(true)
  })

  it('re-uploads when the same files are reordered', () => {
    expect(existingSetMatchesInOrder([item('a'), item('b'), item('c')], ['c', 'a', 'b'])).toBe(false)
  })

  it('re-uploads when counts differ or a file changed', () => {
    expect(existingSetMatchesInOrder([item('a'), item('b')], ['a', 'b', 'c'])).toBe(false)
    expect(existingSetMatchesInOrder([item('a'), item('b')], ['a', 'x'])).toBe(false)
  })

  it('re-uploads when any existing screenshot is not COMPLETE or has no checksum', () => {
    expect(existingSetMatchesInOrder([item('a'), item('b', 'UPLOAD_COMPLETE')], ['a', 'b'])).toBe(false)
    expect(existingSetMatchesInOrder([{ attributes: {} }, item('b')], ['a', 'b'])).toBe(false)
  })
})
