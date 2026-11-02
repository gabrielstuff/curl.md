import type { Plugin as OpenCodePlugin } from '@opencode/plugin'
import * as curlmd from 'curl.md'
import * as curlmdInternal from 'curl.md/internal'
import { fetchPage, type FetchOptionArgs, type Resolver } from './fetch.ts'

const id = '@curl.md/opencode'

/**
 * OpenCode v2 server part.
 *
 * The v2 runtime calls `setup(ctx)`; the v1 runtime ignores it and calls the
 * `server()` function composed in `./server.ts`.
 */
export const plugin: OpenCodePlugin.Plugin = {
  id,
  async setup(ctx) {
    const options = ctx.options as { webfetch?: boolean } | undefined
    const webfetch = typeof options?.webfetch === 'boolean' ? options.webfetch : true
    const baseUrl = process.env.CURLMD_BASE_URL || curlmd.defaultBaseUrl
    const apiKey = process.env.CURLMD_API_KEY
    const resolver = curlmdInternal.Auth.createResolver(baseUrl, apiKey)

    await ctx.tool.transform((editor) => {
      editor.add(createFetchTool({ baseUrl, resolver, toolName: 'curl_md' }))
      if (webfetch) editor.add(createFetchTool({ baseUrl, resolver, toolName: 'webfetch' }))
    })
  },
}

const compatibilityProperties = {
  format: {
    type: 'string',
    enum: ['html', 'markdown', 'text'],
    description: 'Compatibility option for built-in webfetch calls. Output is always markdown.',
  },
  fresh: { type: 'boolean', description: 'Bypass cache and fetch live.' },
  keywords: {
    type: 'array',
    items: { type: 'string' },
    description: 'Keywords to focus extraction on relevant sections.',
  },
  mode: {
    type: 'string',
    enum: ['rush', 'smart'],
    description: 'rush: faster. smart: better section selection on long or noisy pages.',
  },
  objective: {
    type: 'string',
    description: 'Specific question to answer from the page. Use when only part matters.',
  },
  timeout: {
    type: 'number',
    description:
      'Compatibility option for built-in webfetch calls. Fetch timing is managed internally.',
  },
} as const

function createFetchTool(input: {
  baseUrl: string
  resolver: Resolver
  toolName: 'curl_md' | 'webfetch'
}) {
  const isWebfetch = input.toolName === 'webfetch'

  return {
    name: input.toolName,
    description: isWebfetch
      ? 'Overrides built-in webfetch with markdown output.'
      : 'Fetch a URL as markdown.',
    input: {
      type: 'object',
      properties: {
        ...(isWebfetch ? compatibilityProperties : {}),
        options: {
          type: 'object',
          description: 'Optional fetch settings.',
          properties: compatibilityProperties,
          additionalProperties: false,
        },
        url: {
          type: 'string',
          description:
            'HTTP(S) URL or bare domain to fetch. Prefer the canonical docs or article URL.',
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
    async execute(args: unknown, context: { signal: AbortSignal }) {
      const toolArgs = args as FetchOptionArgs & {
        options?: FetchOptionArgs
        url: string
      }
      const fetchOptions = {
        fresh: toolArgs.options?.fresh,
        keywords: toolArgs.options?.keywords,
        mode: toolArgs.options?.mode,
        objective: toolArgs.options?.objective,
        ...(isWebfetch
          ? {
              fresh: toolArgs.options?.fresh ?? toolArgs.fresh,
              keywords: toolArgs.options?.keywords ?? toolArgs.keywords,
              mode: toolArgs.options?.mode ?? toolArgs.mode,
              objective: toolArgs.options?.objective ?? toolArgs.objective,
            }
          : {}),
      } satisfies FetchOptionArgs

      const result = await fetchPage({
        baseUrl: input.baseUrl,
        fresh: fetchOptions.fresh,
        keywords: fetchOptions.keywords,
        mode: fetchOptions.mode,
        objective: fetchOptions.objective,
        resolver: input.resolver,
        signal: context.signal,
        url: toolArgs.url,
      })

      return {
        content: result.markdown,
        metadata: {
          auth: result.auth,
          cache: result.cache,
          fresh: result.fresh,
          request_id: result.request_id,
          tokens_saved: result.tokens_saved,
          url: result.url,
        },
      }
    },
  }
}
