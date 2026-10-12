import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

// Paths App Store Connect no longer serves (checked live 2026-10-07): they
// return 404/403, and several callers treat 404 as "nothing there".
const DEAD_PATHS = [
  /\/v1\/inAppPurchasesV2\/\$\{/, // item routes moved to /v2/inAppPurchases/{id}
  /['`"]https:\/\/api\.appstoreconnect\.apple\.com\/v1\/inAppPurchasesV2['`"]/, // create moved to POST /v2/inAppPurchases
  /\/v1\/inAppPurchasePricePoints\?/, // global list is 403; use /v2/inAppPurchases/{id}/pricePoints
]

const FILES = ['lib/services/appstore.ts', 'functions/src/pushWorker.ts']

describe('App Store Connect endpoints', () => {
  for (const file of FILES) {
    it(`${file} calls no dead endpoints`, () => {
      const source = readFileSync(path.join(__dirname, '..', file), 'utf8')
      for (const dead of DEAD_PATHS) expect(source, String(dead)).not.toMatch(dead)
    })
  }
})
