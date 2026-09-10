import {
  Button,
  Codicon,
  host,
  PALETTE_AREA,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA
} from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'open-brain-browser'
const LOCAL_DASHBOARD_URL = 'http://127.0.0.1:3049'
const HOSTED_DASHBOARD_URL = 'https://temporary-quick-boron-fefsc1w.vercel.app'

function OpenBrainPage({ api, openExternal }) {
  const [state, setState] = useState({ status: 'starting', error: '' })

  const launch = async () => {
    setState({ status: 'starting', error: '' })
    try {
      await api.launch()
      setState({ status: 'ready', error: '' })
    } catch (error) {
      setState({
        status: 'error',
        error: String(error?.message || error || 'The dashboard could not be started.')
      })
    }
  }

  useEffect(() => {
    void launch()
  }, [])

  return jsxs('div', {
    className: 'flex h-full min-h-0 flex-col overflow-hidden bg-background',
    children: [
      jsxs('header', {
        className: 'flex items-center justify-between gap-3 border-b border-(--ui-stroke-secondary) px-4 py-3',
        children: [
          jsxs('div', {
            className: 'min-w-0',
            children: [
              jsxs('h1', {
                className: 'flex items-center gap-2 text-sm font-semibold text-foreground',
                children: [jsx(Codicon, { name: 'database', size: '1rem' }), 'Open Brain Dashboard']
              }),
              jsx('p', {
                className: 'truncate text-xs text-(--ui-text-tertiary)',
                children: 'Authenticated local dashboard · hard deletion disabled'
              })
            ]
          }),
          jsxs('div', {
            className: 'flex shrink-0 gap-2',
            children: [
              state.status === 'error'
                ? jsx(Button, { variant: 'outline', size: 'sm', onClick: launch, children: 'Retry' })
                : null,
              jsx(Button, {
                variant: 'outline',
                size: 'sm',
                onClick: () => openExternal(HOSTED_DASHBOARD_URL),
                children: 'Open in Browser'
              })
            ]
          })
        ]
      }),
      state.status === 'ready'
        ? jsx('iframe', {
            className: 'min-h-0 flex-1 border-0 bg-background',
            src: LOCAL_DASHBOARD_URL,
            title: 'Open Brain Dashboard'
          })
        : jsx('div', {
            className: 'grid min-h-0 flex-1 place-items-center p-6',
            children: jsxs('div', {
              className: 'max-w-md rounded-lg border border-(--ui-stroke-secondary) p-6 text-center',
              children: [
                jsx(Codicon, {
                  name: state.status === 'error' ? 'warning' : 'loading',
                  size: '1.5rem',
                  className: state.status === 'starting' ? 'animate-spin' : ''
                }),
                jsx('div', {
                  className: 'mt-3 text-sm font-medium text-foreground',
                  children: state.status === 'error' ? 'Dashboard unavailable' : 'Starting Open Brain…'
                }),
                jsx('div', {
                  className: 'mt-1 text-xs text-(--ui-text-tertiary)',
                  children: state.error || 'The localhost-only dashboard is being prepared.'
                })
              ]
            })
          })
    ]
  })
}
export default {
  id: ID,
  name: 'Open Brain Dashboard',
  description: 'Authenticated Open Brain dashboard with search, workflow, audit, and capture.',
  defaultEnabled: true,
  register(ctx) {
    const api = {
      launch: () => ctx.rest('/launch', { method: 'POST', timeoutMs: 60000 })
    }

    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: '/open-brain' },
        render: () => jsx(OpenBrainPage, { api, openExternal: ctx.os.openExternal })
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        order: 60,
        data: { path: '/open-brain', label: 'Open Brain', codicon: 'database' }
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'open-brain-browser.open',
          label: 'Open Brain: Open dashboard',
          keywords: ['open brain', 'memory', 'thoughts', 'search', 'dashboard'],
          run: () => host.navigate('/open-brain')
        }
      }
    ])
  }
}
