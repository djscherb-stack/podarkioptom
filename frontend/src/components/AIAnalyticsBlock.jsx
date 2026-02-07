import { useState } from 'react'
import { API, apiFetch } from '../api'

const PRODUCTION_ORDER = ['ЧАЙ', 'ГРАВИРОВКА', 'ЛЮМИНАРК']

export default function AIAnalyticsBlock({ dateStr }) {
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState(null)

  const handleRun = () => {
    if (!dateStr) return
    setFetchError(null)
    setLoading(true)
    setResult(null)
    apiFetch(`${API}/day/${dateStr}/ai-analytics`)
      .then((data) => setResult(data))
      .catch((e) => {
        setFetchError(e.message)
        setResult(null)
      })
      .finally(() => setLoading(false))
  }

  const notConfigured = result && !result.enabled
  const hasError = result?.error || fetchError
  const hasData = result?.enabled && result?.productions && Object.keys(result.productions).length > 0

  return (
    <section className="production-section ai-analytics-section">
      <div className="ai-analytics-header">
        <h2 className="production-title">ИИ-аналитика за день</h2>
        <p className="ai-analytics-desc">
          Оценка выработки по производствам, тренд за 30 дней, замечания по данным и вопросы для руководителей.
        </p>
        <button
          type="button"
          className="btn-ai-run"
          onClick={handleRun}
          disabled={loading || !dateStr}
          aria-busy={loading}
        >
          {loading ? 'Запрос к ИИ…' : 'Запустить ИИ-аналитику'}
        </button>
      </div>

      {loading && (
        <div className="ai-analytics-loading" aria-live="polite">
          Загрузка ответа от ИИ (проверка данных за день, тренд за 30 дней, формирование вопросов)…
        </div>
      )}

      {!loading && notConfigured && (
        <div className="ai-analytics-not-configured">
          <p>{result?.error || 'ИИ-аналитика не настроена.'}</p>
          <p className="ai-analytics-hint">Добавьте <code>OPENAI_API_KEY</code> в переменные окружения (например, в <code>.env</code>) на сервере.</p>
        </div>
      )}

      {!loading && fetchError && (
        <div className="ai-analytics-error">
          Ошибка: {fetchError}
        </div>
      )}

      {!loading && result?.enabled && result?.error && !hasData && (
        <div className="ai-analytics-error">
          <p>{result.error}</p>
          {result.debug_error_type && (
            <p className="ai-analytics-debug" title="Для диагностики">
              Тип ошибки: <code>{result.debug_error_type}</code>
            </p>
          )}
        </div>
      )}

      {!loading && hasData && (
        <div className="ai-analytics-results">
          {PRODUCTION_ORDER.map((prodName) => {
            const block = result.productions[prodName]
            if (!block) return null
            const assessment = block.assessment || ''
            const trendSummary = block.trend_summary || ''
            const issues = Array.isArray(block.issues) ? block.issues : []
            const questions = Array.isArray(block.questions) ? block.questions : []
            return (
              <div key={prodName} className="ai-analytics-card">
                <h3 className="ai-analytics-card-title">{prodName}</h3>
                {assessment && (
                  <div className="ai-analytics-assessment">
                    <span className="ai-analytics-label">Оценка выработки</span>
                    <p>{assessment}</p>
                  </div>
                )}
                {trendSummary && (
                  <div className="ai-analytics-trend">
                    <span className="ai-analytics-label">Тренд за 30 дней</span>
                    <p>{trendSummary}</p>
                  </div>
                )}
                {issues.length > 0 && (
                  <div className="ai-analytics-issues">
                    <span className="ai-analytics-label">Замечания (тренды, скачки, данные)</span>
                    <ul>
                      {issues.map((issue, i) => (
                        <li key={i} className="ai-issue-item">{issue}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {questions.length > 0 && (
                  <div className="ai-analytics-questions">
                    <span className="ai-analytics-label">Вопросы для руководителя производства</span>
                    <ol>
                      {questions.map((q, i) => (
                        <li key={i} className="ai-question-item">{q}</li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            )
          })}
          {result.general_notes?.trim() && (
            <div className="ai-analytics-general">
              <span className="ai-analytics-label">Общие замечания</span>
              <p>{result.general_notes}</p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
