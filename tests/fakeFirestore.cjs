// Small transactional fake: serializes transactions and rejects reads after writes.
const clone = value => value === undefined ? undefined : structuredClone(value)
const number = value => value instanceof Date ? value.getTime() : value
class FakeFirestore {
  constructor(seed = {}) { this.rows = new Map(Object.entries(seed)); this.tail = Promise.resolve(); this.failCommit = null }
  collection(path) { return new Query(this, path) }
  async runTransaction(fn) {
    const run = this.tail.then(async () => {
      const writes = []
      const tx = {
        get: async ref => { if (writes.length) throw new Error('Read after write'); return ref.get() },
        set: (ref, data, opts) => { writes.push(['set', ref, clone(data), opts]); return tx },
        update: (ref, data) => { writes.push(['set', ref, clone(data), { merge: true }]); return tx },
        delete: ref => { writes.push(['delete', ref]); return tx },
      }
      const result = await fn(tx)
      if (this.failCommit?.(writes)) { this.failCommit = null; throw new Error('Injected DB commit failure') }
      for (const [kind, ref, data, opts] of writes) {
        if (kind === 'delete') this.rows.delete(ref.path)
        else this.rows.set(ref.path, opts?.merge ? { ...this.rows.get(ref.path), ...data } : data)
      }
      return result
    })
    this.tail = run.catch(() => {})
    return run
  }
}
class Ref {
  constructor(db, path) { this.db = db; this.path = path; this.id = path.split('/').pop() }
  collection(name) { return this.db.collection(`${this.path}/${name}`) }
  async get() { const row = clone(this.db.rows.get(this.path)); return { id: this.id, ref: this, exists: row !== undefined, data: () => clone(row) } }
  async set(data, opts) { return this.db.runTransaction(tx => tx.set(this, data, opts)) }
  async update(data) { return this.db.runTransaction(tx => tx.update(this, data)) }
  async delete() { return this.db.runTransaction(tx => tx.delete(this)) }
}
class Query {
  constructor(db, path, filters = [], order = null, max = Infinity) { Object.assign(this, { db, path, filters, order, max }) }
  doc(id) { return new Ref(this.db, `${this.path}/${id}`) }
  where(field, op, value) { return new Query(this.db, this.path, [...this.filters, [field, op, value]], this.order, this.max) }
  orderBy(field) { return new Query(this.db, this.path, this.filters, field, this.max) }
  limit(n) { return new Query(this.db, this.path, this.filters, this.order, n) }
  startAt(value) { return this.where('__name__', '>=', value) }
  endAt(value) { return this.where('__name__', '<=', value) }
  async listDocuments() { return (await this.get()).docs.map(doc => doc.ref) }
  count() { return { get: async () => { const snap = await this.get(); return { data: () => ({ count: snap.size }) } } } }
  async get() {
    let docs = []
    for (const [path, data] of this.db.rows) {
      if (!path.startsWith(`${this.path}/`) || path.split('/').length !== this.path.split('/').length + 1) continue
      const id = path.split('/').pop()
      const matches = this.filters.every(([field, op, expected]) => {
        const actual = number(field === '__name__' ? id : data[field]), value = number(expected)
        return op === '==' ? actual === value : op === '<=' ? actual <= value : op === '>=' ? actual >= value : false
      })
      if (matches && (!this.order || this.order === '__name__' || data[this.order] !== undefined)) docs.push(await new Ref(this.db, path).get())
    }
    if (this.order) docs.sort((a, b) => {
      const x = number(this.order === '__name__' ? a.id : a.data()[this.order]), y = number(this.order === '__name__' ? b.id : b.data()[this.order])
      return x < y ? -1 : x > y ? 1 : 0
    })
    docs = docs.slice(0, this.max)
    return { docs, size: docs.length, empty: docs.length === 0, forEach: fn => docs.forEach(fn) }
  }
}
module.exports = { FakeFirestore }
