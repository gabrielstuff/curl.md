import * as opencodePlugin from '@opencode-ai/plugin'
import * as curlmd from 'curl.md'
import * as curlmdInternal from 'curl.md/internal'
import { fetchPage, type FetchOptionArgs, type Resolver } from './fetch.ts'

export const plugin: opencodePlugin.Plugin = async (_input, options) => {
  const baseUrl = process.env.CURLMD_BASE_URL || curlmd.defaultBaseUrl
  const apiKey = process.env.CURLMD_API_KEY
  const resolver = curlmdInternal.Auth.createResolver(baseUrl, apiKey)
  const webfetch = typeof options?.webfetch === 'boolean' ? options.webfetch : true

  return {
    tool: {
      curl_md: createFetchTool({ baseUrl, resolver, toolName: 'curl_md' }),
      ...(webfetch
        ? { webfetch: createFetchTool({ baseUrl, resolver, toolName: 'webfetch' }) }
        : {}),
    },
  }
}

function createFetchTool(input: {
  baseUrl: string
  resolver: Resolver
  toolName: 'curl_md' | 'webfetch'
}) {
  const optionArgs = {
    format: opencodePlugin.tool.schema
      .enum(['html', 'markdown', 'text'])
      .optional()
      .describe('Compatibility option for built-in webfetch calls. Output is always markdown.'),
    fresh: opencodePlugin.tool.schema.boolean().optional().describe('Bypass cache and fetch live.'),
    keywords: opencodePlugin.tool.schema
      .array(opencodePlugin.tool.schema.string())
      .optional()
      .describe('Keywords to focus extraction on relevant sections.'),
    mode: opencodePlugin.tool.schema
      .enum(['rush', 'smart'])
      .optional()
      .describe('rush: faster. smart: better section selection on long or noisy pages.'),
    objective: opencodePlugin.tool.schema
      .string()
      .optional()
      .describe('Specific question to answer from the page. Use when only part matters.'),
    timeout: opencodePlugin.tool.schema
      .number()
      .optional()
      .describe(
        'Compatibility option for built-in webfetch calls. Fetch timing is managed internally.',
      ),
  }
  type FetchToolArgs = FetchOptionArgs & {
    options?: FetchOptionArgs
    url: string
  }

  return opencodePlugin.tool({
    description:
      input.toolName === 'webfetch'
        ? 'Overrides built-in webfetch with markdown output.'
        : 'Fetch a URL as markdown.',
    args: {
      ...(input.toolName === 'webfetch' ? optionArgs : {}),
      options: opencodePlugin.tool.schema
        .object(optionArgs)
        .optional()
        .describe('Optional fetch settings.'),
      url: opencodePlugin.tool.schema
        .string()
        .describe('HTTP(S) URL or bare domain to fetch. Prefer the canonical docs or article URL.'),
    },
    async execute(args, ctx) {
      const toolArgs = args as FetchToolArgs
      const fetchOptions = {
        fresh: toolArgs.options?.fresh,
        keywords: toolArgs.options?.keywords,
        mode: toolArgs.options?.mode,
        objective: toolArgs.options?.objective,
        ...(input.toolName === 'webfetch'
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
        signal: ctx.abort,
        url: toolArgs.url,
      })

      const metadata = {
        auth: result.auth,
        cache: result.cache,
        fresh: result.fresh,
        request_id: result.request_id,
        tokens_saved: result.tokens_saved,
        url: result.url,
      }

      try {
        ctx.metadata({
          title: result.url,
          metadata,
        })
      } catch {}

      return result.markdown
    },
  })
}
