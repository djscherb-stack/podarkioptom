const API = '/api'

const WAKING_MSG = 'Сервер загружается. Подождите минуту и обновите страницу.'

export async function apiFetch(url, options = {}) {
  const r = await fetch(url, options)
  const ct = r.headers.get('content-type') || ''
  if (!ct.includes('application/json')) {
    const text = await r.text()
    if (text.includes('<!DOCTYPE') || text.includes('<html')) {
      throw new Error(WAKING_MSG)
    }
    throw new Error(`Ошибка сервера: ${r.status}`)
  }
  const data = await r.json()
  if (!r.ok && data?.error) throw new Error(data.error)
  if (!r.ok) throw new Error(`Ошибка сервера: ${r.status}`)
  return data
}

export { API }
