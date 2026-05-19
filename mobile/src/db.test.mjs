import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
process.chdir(resolve(__dirname, '../public'))

const db = await import('./db.js')

test('insertRows inserts a batch with quoted identifiers and nulls', async () => {
  await db.openDatabase()
  db.execRaw('CREATE TABLE "order lines" ("id" TEXT, "select" TEXT)')

  db.insertRows('order lines', ['id', 'select'], [
    { id: '1', select: 'alpha' },
    { id: '2', select: null },
  ])

  const result = db.execRaw('SELECT * FROM "order lines" ORDER BY "id"')

  assert.deepEqual(result[0].columns, ['id', 'select'])
  assert.deepEqual(result[0].values, [
    ['1', 'alpha'],
    ['2', null],
  ])
  db.closeDatabase()
})
