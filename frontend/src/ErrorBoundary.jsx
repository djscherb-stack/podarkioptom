import { Component } from 'react'

export class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', maxWidth: 600, margin: '0 auto', fontFamily: 'sans-serif' }}>
          <h2 style={{ color: '#c53030' }}>Ошибка приложения</h2>
          <pre style={{ background: '#f7fafc', padding: '1rem', overflow: 'auto', fontSize: '0.85rem' }}>
            {this.state.error.toString()}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: '1rem', padding: '0.5rem 1rem', cursor: 'pointer' }}
          >
            Обновить страницу
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
