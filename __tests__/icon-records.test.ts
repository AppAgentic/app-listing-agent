import { beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ set:vi.fn(), paths:[] as string[] }))
vi.mock('@/lib/firebase/admin', () => {
  const ref = { collection:(value:string) => { mock.paths.push(value); return ref }, doc:(value:string) => { mock.paths.push(value); return ref }, set:mock.set }
  return { adminDb:ref }
})
import { saveIconRecord } from '@/lib/services/icon-records'
beforeEach(() => { mock.paths.length=0; mock.set.mockReset() })
describe('dashboard icon collection contract', () => {
  it.each([undefined,'org-1'])('uses the list collection and normalizes legacy IDs (%s)', async orgId => {
    const id = await saveIconRecord({success:true,originalUrl:'original',ios:'ios',android:'android'}, {userId:'u',projectId:'p',orgId,style:'3d'})
    expect(mock.paths).toEqual([orgId?'organizations':'users',orgId||'u','projects','p','icons',id])
    expect(mock.set).toHaveBeenCalledWith(expect.objectContaining({id,style:'tactile-3d',createdBy:'u',createdAt:expect.anything(),originalUrl:'original'}))
  })
})
