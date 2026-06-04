import { Link, useRouterState } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'

const nav = [
  { to: '/', label: '书架' },
  { to: '/config', label: '添加' },
  { to: '/sources', label: '书源' },
] as const

export function AppLayout({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: s => s.location.pathname })

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between gap-4">
        <Link to="/" className="text-xl font-bold tracking-tight">
          Cartoon
        </Link>
        <nav className="flex gap-1 rounded-lg border border-border bg-card p-1">
          {nav.map(item => {
            const active = item.to === '/'
              ? pathname === '/'
              : item.to === '/config'
                ? pathname.startsWith('/config') || pathname.startsWith('/search')
                : pathname.startsWith(item.to)
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
      </header>
      {children}
    </div>
  )
}
