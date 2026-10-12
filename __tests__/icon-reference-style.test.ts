import { afterEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
const mocks = vi.hoisted(() => ({ render:vi.fn(), upload:vi.fn() }))
vi.mock('@/lib/services/icon-engine', () => ({ renderIconImage:mocks.render }))
vi.mock('@/lib/services/r2', () => ({ uploadFile:mocks.upload }))
import { generateIcon } from '@/lib/services/icon-generator'
afterEach(() => vi.clearAllMocks())
describe('reference art direction', () => {
  it('keeps selected style, brand colours and concept when a reference is supplied', async () => {
    mocks.render.mockResolvedValue(await sharp({create:{width:16,height:16,channels:3,background:'#fff'}}).png().toBuffer())
    mocks.upload.mockResolvedValue({url:'https://images.test/icon.png'})
    const result=await generateIcon({source:{type:'reference',referenceImageUrl:'https://images.test/ref.png'},style:'liquid-glass',colors:{primary:'#123456'},concept:{subject:'a flame',metaphor:'daily momentum',colorIdea:'red'}},{userId:'u',projectId:'p'})
    expect(result.success).toBe(true)
    const [prompt,refs]=mocks.render.mock.calls[0]
    expect(prompt).toContain('frosted glass');expect(prompt).toContain('#123456');expect(prompt).toContain('a flame')
    expect(prompt).toContain('No rounded corners');expect(refs).toEqual(['https://images.test/ref.png'])
  })
})
