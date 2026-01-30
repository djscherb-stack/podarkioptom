const API = '/api'

const WAKING_MSG = 'Сервер загружается. Подождите минуту и обновите страницу.'

export class AuthError extends Error {
  constructor() {
    super('Требуется авторизация')
    this.name = 'AuthError'
  }
}

export async function apiFetch(url, options = {}) {
  const r = await fetch(url, { ...options, credentials: 'include' })
  const ct = r.headers.get('content-type') || ''
  if (!ct.includes('application/json')) {
    const text = await r.text()
    if (text.includes('<!DOCTYPE') || text.includes('<html')) {
      throw new Error(WAKING_MSG)
    }
    throw new Error(`Ошибка сервера: ${r.status}`)
  }
  const data = await r.json()
  if (r.status === 401) throw new AuthError()
  if (!r.ok && data?.error) throw new Error(data.error)
  if (!r.ok) throw new Error(`Ошибка сервера: ${r.status}`)
  return data
}

export { API }
