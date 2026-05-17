let baseUrl = ''

export function setBaseUrl(url) {
  baseUrl = url.replace(/\/+$/, '')
}

export function getBaseUrl() {
  return baseUrl
}

async function request(path, options = {}) {
  const url = `${baseUrl}${path}`
  const resp = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(text || `请求失败: ${resp.status}`)
  }
  return resp.json()
}

export async function testConnection(config) {
  return request('/api/connect/test', {
    method: 'POST',
    body: JSON.stringify(config),
  })
}

export async function listDatabases(config) {
  return request('/api/databases', {
    method: 'POST',
    body: JSON.stringify(config),
  })
}

export async function getTables(config) {
  return request('/api/tables', {
    method: 'POST',
    body: JSON.stringify(config),
  })
}

export async function getTableSchema(config, table) {
  return request('/api/table/schema', {
    method: 'POST',
    body: JSON.stringify({ ...config, table }),
  })
}

export async function getTableRows(config, table, offset = 0, limit = 100000) {
  return request('/api/table/rows', {
    method: 'POST',
    body: JSON.stringify({ ...config, table, offset, limit }),
  })
}
