import { useState, useEffect, useCallback } from 'react'
import { API, apiFetch } from '../api'

export default function DisassemblyNomenclaturePage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  const fetchList = useCallback(() => {
    setLoading(true)
    setError(null)
    apiFetch(`${API}/disassembly/nomenclature`)
      .then((res) => setItems(res?.items ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  const copyAll = () => {
    const text = items.join('\n')
    if (!text) return
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => setCopied(false))
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Номенклатура разборки</h1>
        <div className="controls">
          <button type="button" className="btn-refresh" onClick={fetchList} title="Обновить">
            ⟳
          </button>
          <button
            type="button"
            className="btn-copy-nomenclature"
            onClick={copyAll}
            disabled={loading || items.length === 0}
            title="Скопировать все наименования (по одному на строку) для вставки в 1С"
          >
            {copied ? 'Скопировано' : 'Скопировать в 1С'}
          </button>
        </div>
      </div>

      <p className="page-description">
        Все наименования номенклатуры из данных разборки возвратов — как в таблицах. Нажмите «Скопировать в 1С», затем вставьте в 1С (каждая строка — одно наименование).
      </p>

      {error && <div className="error">Ошибка: {error}</div>}
      {loading && <div className="loading">Загрузка…</div>}

      {!loading && !error && (
        <div className="nomenclature-table-wrap">
          <table className="nomenclature-table">
            <thead>
              <tr>
                <th>Наименование</th>
              </tr>
            </thead>
            <tbody>
              {items.map((name, i) => (
                <tr key={i}>
                  <td className="nomenclature-td-name">{name}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length === 0 && (
            <p className="empty">Нет данных. Загрузите файлы разборки (001–004) в папку Google Drive или через Админку.</p>
          )}
        </div>
      )}
    </div>
  )
}
