const API = '/api'

export const THEME_OPTIONS = [
  { id: 'dark', label: 'Тёмная (по умолчанию)' },
  { id: 'bw', label: 'Чёрно-белая' },
  { id: '1c', label: '1С' },
  { id: 'white-blue', label: 'Бело-синяя' },
  { id: 'bright', label: 'Яркая' },
  { id: 'sheets', label: 'Google Таблицы' },
]

export function applyTheme(theme) {
  const root = document.documentElement
  if (theme && ['dark', 'bw', '1c', 'white-blue', 'bright', 'sheets'].includes(theme)) {
    root.setAttribute('data-theme', theme)
  } else {
    root.setAttribute('data-theme', 'dark')
  }
}

export async function fetchTheme() {
  const r = await fetch(`${API}/theme`)
  const d = await r.json().catch(() => ({}))
  return d.theme || 'dark'
}

export async function saveTheme(theme) {
  const r = await fetch(`${API}/theme`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ theme }),
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err.error || 'Ошибка сохранения')
  }
  return (await r.json()).theme
}
