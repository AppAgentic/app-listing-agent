type DocumentData = Record<string, any>

function applyValues(existing: DocumentData, incoming: DocumentData): DocumentData {
  const next = { ...existing }
  for (const [key, value] of Object.entries(incoming)) {
    if (value?.constructor?.name === 'NumericIncrementTransform') {
      next[key] = (typeof next[key] === 'number' ? next[key] : 0) + value.operand
    } else {
      next[key] = value
    }
  }
  return next
}

export function createFakeFirestore() {
  const documents = new Map<string, DocumentData>()
  let transactionQueue = Promise.resolve()

  class FakeSnapshot {
    constructor(readonly ref: FakeDocumentReference, private readonly value?: DocumentData) {}
    get exists() { return this.value !== undefined }
    get id() { return this.ref.id }
    data() { return this.value }
  }

  class FakeQuery {
    private queryLimit = Infinity
    constructor(
      private readonly collectionPath: string,
      private readonly field: string,
      private readonly expected: unknown
    ) {}
    limit(value: number) {
      this.queryLimit = value
      return this
    }
    async get() {
      const docs = Array.from(documents.entries())
        .filter(([path, data]) => {
          const parent = path.slice(0, path.lastIndexOf('/'))
          return parent === this.collectionPath && data[this.field] === this.expected
        })
        .slice(0, this.queryLimit)
        .map(([path, data]) => new FakeSnapshot(new FakeDocumentReference(path), data))
      return { empty: docs.length === 0, docs }
    }
  }

  class FakeCollectionReference {
    constructor(readonly path: string) {}
    doc(id: string) { return new FakeDocumentReference(`${this.path}/${id}`) }
    where(field: string, operator: string, expected: unknown) {
      if (operator !== '==') throw new Error(`Unsupported fake query operator: ${operator}`)
      return new FakeQuery(this.path, field, expected)
    }
  }

  class FakeDocumentReference {
    constructor(readonly path: string) {}
    get id() { return this.path.slice(this.path.lastIndexOf('/') + 1) }
    collection(name: string) { return new FakeCollectionReference(`${this.path}/${name}`) }
    async get() { return new FakeSnapshot(this, documents.get(this.path)) }
  }

  function commitWrites(writes: Array<{
    kind: 'create' | 'update' | 'set'
    ref: FakeDocumentReference
    data: DocumentData
    merge?: boolean
  }>) {
    for (const write of writes) {
      const existing = documents.get(write.ref.path)
      if (write.kind === 'create' && existing) throw new Error('Document already exists')
      if (write.kind === 'update' && !existing) throw new Error('Document does not exist')
      const base = write.kind === 'set' && !write.merge ? {} : (existing || {})
      documents.set(write.ref.path, applyValues(base, write.data))
    }
  }

  const adminDb = {
    collection(name: string) {
      return new FakeCollectionReference(name)
    },
    runTransaction<T>(callback: (transaction: any) => Promise<T>): Promise<T> {
      const run = transactionQueue.then(async () => {
        const writes: Array<{
          kind: 'create' | 'update' | 'set'
          ref: FakeDocumentReference
          data: DocumentData
          merge?: boolean
        }> = []
        const transaction = {
          get: async (ref: FakeDocumentReference) => new FakeSnapshot(ref, documents.get(ref.path)),
          create: (ref: FakeDocumentReference, data: DocumentData) => writes.push({ kind: 'create', ref, data }),
          update: (ref: FakeDocumentReference, data: DocumentData) => writes.push({ kind: 'update', ref, data }),
          set: (ref: FakeDocumentReference, data: DocumentData, options?: { merge?: boolean }) => {
            writes.push({ kind: 'set', ref, data, merge: options?.merge })
          },
        }
        const result = await callback(transaction)
        commitWrites(writes)
        return result
      })
      transactionQueue = run.then(() => undefined, () => undefined)
      return run
    },
  }

  return {
    adminDb,
    seed(path: string, data: DocumentData) { documents.set(path, data) },
    read(path: string) { return documents.get(path) },
    reset() {
      documents.clear()
      transactionQueue = Promise.resolve()
    },
  }
}
