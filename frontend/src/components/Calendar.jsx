import { useState, useEffect } from 'react'

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

function toStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

export default function Calendar({ value, onChange }) {
  const current = value ? new Date(value + 'T12:00:00') : new Date()
  const [viewDate, setViewDate] = useState(() => new Date(current.getFullYear(), current.getMonth(), 1))

  useEffect(() => {
    if (value) {
      const v = new Date(value + 'T12:00:00')
      setViewDate(d => {
        if (d.getFullYear() !== v.getFullYear() || d.getMonth() !== v.getMonth()) {
          return new Date(v.getFullYear(), v.getMonth(), 1)
        }
        return d
      })
    }
  }, [value])

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  const startPad = (first.getDay() + 6) % 7
  const daysInMonth = last.getDate()

  const cells = []
  for (let i = 0; i < startPad; i++) {
    const d = new Date(year, month, 1 - (startPad - i))
    cells.push({ date: d, str: toStr(d), other: true })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(year, month, d)
    cells.push({ date: dt, str: toStr(dt), other: false })
  }
  const remainder = 7 - (cells.length % 7)
  if (remainder < 7) {
    for (let i = 1; i <= remainder; i++) {
      const d = new Date(year, month + 1, i)
      cells.push({ date: d, str: toStr(d), other: true })
    }
  }

  const prevMonth = () => setViewDate(d => new Date(d.getFullYear(), d.getMonth() - 1))
  const nextMonth = () => setViewDate(d => new Date(d.getFullYear(), d.getMonth() + 1))

  return (
    <div className="mini-calendar">
      <div className="mini-cal-header">
        <button type="button" onClick={prevMonth} className="mini-cal-nav">‹</button>
        <span className="mini-cal-title">{MONTHS[month]} {year}</span>
        <button type="button" onClick={nextMonth} className="mini-cal-nav">›</button>
      </div>
      <div className="mini-cal-weekdays">
        {WEEKDAYS.map(d => <span key={d} className="mini-cal-wd">{d}</span>)}
      </div>
      <div className="mini-cal-grid">
        {cells.map(({ date, str, other }) => (
          <button
            key={str}
            type="button"
            className={`mini-cal-day ${other ? 'other' : ''} ${value === str ? 'selected' : ''}`}
            onClick={() => onChange(str)}
          >
            {date.getDate()}
          </button>
        ))}
      </div>
    </div>
  )
}
