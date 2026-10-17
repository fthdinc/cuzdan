import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode; label?: string }
interface State { error: Error | null }

/** Catches render errors (e.g. engine not ready) and shows a small inline box. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
        <div className="font-medium">{this.props.label ?? 'Bu bölüm gösterilemedi'}</div>
        <div className="mt-0.5 break-words opacity-80">{error.message}</div>
        <button className="mt-2 text-xs font-medium underline" onClick={() => this.setState({ error: null })}>
          Tekrar dene
        </button>
      </div>
    )
  }
}
