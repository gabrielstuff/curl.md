import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defaultBaseUrl } from 'curl.md'
import { HttpResponse, http, passthrough } from 'msw'
import { setupServer } from 'msw/node'
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { plugin } from './server.ts'
import { tuiPlugin } from './tui.ts'

const server = setupServer()

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  return () => server.close()
})

beforeEach((context) => {
  const xdgDataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'curlmd-opencode-v2-test-'))
  vi.stubEnv('XDG_DATA_HOME', xdgDataHome)
  context.onTestFinished(() => {
    fs.rmSync(xdgDataHome, { force: true, recursive: true })
  })
})

afterEach(() => {
  server.resetHandlers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

test('exposes one entrypoint for OpenCode v1 and v2', () => {
  expect(plugin.id).toBe('@curl.md/opencode')
  expect(typeof plugin.setup).toBe('function')
  expect(typeof plugin.server).toBe('function')
})

test('registers curl_md and webfetch through the v2 tool transform', async () => {
  const tools = await loadV2Plugin()

  expect([...tools.keys()]).toEqual(['curl_md', 'webfetch'])
})

test('can disable the webfetch override with v2 plugin options', async () => {
  const tools = await loadV2Plugin({ webfetch: false })

  expect([...tools.keys()]).toEqual(['curl_md'])
})

test('returns markdown and metadata from the v2 curl_md tool', async () => {
  server.use(
    http.get('*', async ({ request }) => {
      const url = new URL(request.url)
      if (url.origin !== new URL(defaultBaseUrl).origin) return passthrough()
      return HttpResponse.json(
        { content: '# Example\n\n---\n\nPowered by [curl.md](https://curl.md)' },
        {
          headers: {
            'x-cache': 'HIT',
            'x-request-id': 'req_v2',
            'x-tokens-saved': '256',
          },
        },
      )
    }),
  )

  const tools = await loadV2Plugin()
  const result = await tools
    .get('curl_md')!
    .execute({ url: 'https://example.com/docs' }, { signal: new AbortController().signal })

  expect(result).toEqual({
    content: '# Example\n\n---\n\nPowered by [curl.md](https://curl.md)',
    metadata: {
      auth: 'anon',
      cache: 'HIT',
      fresh: undefined,
      request_id: 'req_v2',
      tokens_saved: 256,
      url: 'https://example.com/docs',
    },
  })
})

test('registers the TUI commands through the v2 keymap layer', async () => {
  const commands: V2Command[] = []
  const context = {
    keymap: {
      layer(factory: () => V2Layer) {
        const layer = factory()
        commands.push(...(layer.commands ?? []))
      },
    },
    ui: {
      dialog: { alert: vi.fn(), clear: vi.fn(), select: vi.fn() },
      toast: { show: vi.fn() },
    },
  }

  const cleanup = await tuiPlugin.setup(context as never)

  expect(commands.map((command) => command.id)).toEqual([
    'curlmd.login',
    'curlmd.logout',
    'curlmd.org',
    'curlmd.status',
  ])
  expect(commands.map((command) => command.slash?.name)).toEqual([
    'curl_md_login',
    'curl_md_logout',
    'curl_md_org',
    'curl_md_status',
  ])
  expect(typeof cleanup).toBe('function')
})

type V2Tool = {
  name: string
  execute: (
    input: unknown,
    context: { signal: AbortSignal },
  ) => Promise<{ content?: string; metadata?: Record<string, unknown> }>
}

type V2Command = {
  id?: string
  slash?: { name: string }
  title?: string
  run: () => void | Promise<void>
}

type V2Layer = {
  commands?: readonly V2Command[]
}

type V2Editor = {
  add(tool: V2Tool): void
  get(name: string): V2Tool | undefined
  list(): V2Tool[]
  namespace(): void
  remove(name: string): void
  update(): void
}

async function loadV2Plugin(options?: Record<string, unknown>) {
  const tools = new Map<string, V2Tool>()
  const editor: V2Editor = {
    add(tool) {
      tools.set(tool.name, tool)
    },
    get(name) {
      return tools.get(name)
    },
    list() {
      return [...tools.values()]
    },
    namespace() {},
    remove(name) {
      tools.delete(name)
    },
    update() {},
  }

  await plugin.setup({
    options: options ?? {},
    tool: {
      transform: async (callback: (editor: V2Editor) => void) => {
        callback(editor)
        return { dispose: async () => {} }
      },
    },
  } as never)

  return tools
}
