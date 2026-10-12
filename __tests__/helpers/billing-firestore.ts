/* In-memory Firestore for billing tests: nested set-merge, dotted update paths, FieldValue.delete,
 * simple where/orderBy/limit queries, serialized transactions, and Firestore's reads-before-writes rule. */
type DocumentData = Record<string, any>

const isPlainObject = (value: unknown): value is DocumentData =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype
const isDelete = (value: unknown) => (value as { constructor?: { name?: string } })?.constructor?.name === 'DeleteTransform'

function mergeDeep(target: DocumentData, source: DocumentData): DocumentData {
  const next = { ...target }
  for (const [key, value] of Object.entries(source)) {
    if (isDelete(value)) delete next[key]
    else if (isPlainObject(value) && isPlainObject(next[key])) next[key] = mergeDeep(next[key], value)
    else next[key] = value
  }
  return next
}

function applyUpdate(target: DocumentData, source: DocumentData): DocumentData {
  const next = structuredCloneSafe(target)
  for (const [path, value] of Object.entries(source)) {
    const parts = path.split('.')
    let cursor = next
    for (const part of parts.slice(0, -1)) {
      if (!isPlainObject(cursor[part])) cursor[part] = {}
      cursor = cursor[part]
    }
    const last = parts[parts.length - 1]
    if (isDelete(value)) delete cursor[last]
    else cursor[last] = value
  }
  return next
}

function structuredCloneSafe(value: DocumentData): DocumentData {
  const out: DocumentData = {}
  for (const [key, item] of Object.entries(value)) out[key] = isPlainObject(item) ? structuredCloneSafe(item) : item
  return out
}

function stripDeletes(value: DocumentData): DocumentData {
  const out: DocumentData = {}
  for (const [key, item] of Object.entries(value)) {
    if (isDelete(item)) continue
    out[key] = isPlainObject(item) ? stripDeletes(item) : item
  }
  return out
}

export function createBillingFirestore() {
  const documents = new Map<string, DocumentData>()
  let queue = Promise.resolve()

  class Snapshot {
    constructor(readonly ref: DocRef, private readonly value?: DocumentData) {}
    get exists() { return this.value !== undefined }
    get id() { return this.ref.id }
    data() { return this.value === undefined ? undefined : structuredCloneSafe(this.value) }
  }

  class Query {
    private filters: Array<[string, string, unknown]> = []
    private order: string | null = null
    private max = Infinity
    constructor(private readonly collectionPath: string) {}
    where(field: string, op: string, value: unknown) { this.filters.push([field, op, value]); return this }
    orderBy(field: string) { this.order = field; return this }
    limit(value: number) { this.max = value; return this }
    async get() {
      let docs = [...documents.entries()].filter(([path, data]) => {
        if (path.slice(0, path.lastIndexOf('/')) !== this.collectionPath) return false
        return this.filters.every(([field, op, value]) => {
          const actual = data[field]
          if (op === '==') return actual === value
          if (op === '<=') return actual <= (value as number)
          throw new Error(`Unsupported operator ${op}`)
        })
      })
      if (this.order) docs = docs.sort((a, b) => a[1][this.order!] - b[1][this.order!])
      const snapshots = docs.slice(0, this.max).map(([path, data]) => new Snapshot(new DocRef(path), data))
      return { empty: snapshots.length === 0, docs: snapshots }
    }
  }

  class CollectionRef extends Query {
    constructor(readonly path: string) { super(path) }
    doc(id: string) { return new DocRef(`${this.path}/${id}`) }
  }

  class DocRef {
    constructor(readonly path: string) {}
    get id() { return this.path.slice(this.path.lastIndexOf('/') + 1) }
    collection(name: string) { return new CollectionRef(`${this.path}/${name}`) }
    async get() { return new Snapshot(this, documents.get(this.path)) }
    async set(data: DocumentData, options?: { merge?: boolean }) { write({ kind: 'set', ref: this, data, merge: options?.merge }) }
    async update(data: DocumentData) { write({ kind: 'update', ref: this, data }) }
    async create(data: DocumentData) { write({ kind: 'create', ref: this, data }) }
  }

  type Write = { kind: 'create' | 'update' | 'set'; ref: DocRef; data: DocumentData; merge?: boolean }
  function write(entry: Write) {
    const existing = documents.get(entry.ref.path)
    if (entry.kind === 'create' && existing) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })
    if (entry.kind === 'update' && !existing) throw new Error('NOT_FOUND')
    if (entry.kind === 'update') documents.set(entry.ref.path, applyUpdate(existing!, entry.data))
    else if (entry.kind === 'set' && entry.merge) documents.set(entry.ref.path, mergeDeep(existing || {}, entry.data))
    else documents.set(entry.ref.path, stripDeletes(entry.data))
  }

  const db = {
    collection: (name: string) => new CollectionRef(name),
    doc: (path: string) => new DocRef(path),
    runTransaction<T>(callback: (transaction: any) => Promise<T>): Promise<T> {
      const run = queue.then(async () => {
        const writes: Write[] = []
        const transaction = {
          get: async (ref: DocRef) => {
            if (writes.length) throw new Error('Firestore transactions require all reads to be executed before all writes.')
            return new Snapshot(ref, documents.get(ref.path))
          },
          create: (ref: DocRef, data: DocumentData) => { writes.push({ kind: 'create', ref, data }) },
          update: (ref: DocRef, data: DocumentData) => { writes.push({ kind: 'update', ref, data }) },
          set: (ref: DocRef, data: DocumentData, options?: { merge?: boolean }) => { writes.push({ kind: 'set', ref, data, merge: options?.merge }) },
        }
        const result = await callback(transaction)
        for (const entry of writes) write(entry)
        return result
      })
      queue = run.then(() => undefined, () => undefined)
      return run
    },
  }

  return {
    db: db as any,
    seed(path: string, data: DocumentData) { documents.set(path, data) },
    read(path: string) { return documents.get(path) },
    paths(prefix: string) { return [...documents.keys()].filter(path => path.startsWith(prefix)) },
  }
}
