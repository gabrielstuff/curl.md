import type { Plugin as TuiPlugin } from '@opencode/plugin/tui'
import * as curlmd from 'curl.md'
import * as curlmdInternal from 'curl.md/internal'
import packageJson from '../package.json' with { type: 'json' }
import {
  buildAlreadyAuthenticatedMessage,
  buildAlreadyLoggedOutMessage,
  buildLoginPrompt,
  buildLoginSuccessMessage,
  buildLogoutSuccessMessage,
  buildOrgSwitchMessage,
  findCliPath,
  openBrowser,
  type OrgChoice,
  readStatus,
} from './tui-shared.ts'
import { createHeaders } from './utils.ts'

const authStatusToastDurationMs = 6 * 1000 // 6 seconds
const statusToastDurationMs = 10 * 1000 // 10 seconds

/**
 * OpenCode v2 TUI part.
 *
 * The v2 runtime calls `setup(context)`; the v1 runtime ignores it and calls the
 * `tui()` function composed in `./tui.ts`.
 */
export const tuiPlugin: TuiPlugin.Definition = {
  id: '@curl.md/opencode',
  async setup(context) {
    const baseUrl = process.env.CURLMD_BASE_URL || curlmd.defaultBaseUrl
    const apiKey = process.env.CURLMD_API_KEY
    let loginAbortController: AbortController | null = null
    const resolver = curlmdInternal.Auth.createResolver(baseUrl, apiKey)

    context.keymap.layer(() => ({
      mode: 'global',
      commands: [
        {
          id: 'curlmd.login',
          title: 'Log in',
          group: 'curl.md',
          palette: true,
          suggested: true,
          slash: { name: 'curl_md_login' },
          run: async () => {
            if (loginAbortController) {
              context.ui.toast.show({
                message: 'Login already in progress.',
                title: 'curl.md',
                variant: 'info',
              })
              return
            }

            const start = await curlmdInternal.Auth.startLogin(baseUrl)
            if (!start.ok) {
              context.ui.toast.show({
                message: `Failed to log in: ${start.error.message}`,
                title: 'curl.md',
                variant: 'error',
              })
              return
            }

            if (start.data.kind === 'already_authenticated') {
              context.ui.dialog.clear()
              context.ui.toast.show({
                duration: authStatusToastDurationMs,
                message: buildAlreadyAuthenticatedMessage(start.data.login),
                title: 'curl.md',
                variant: 'info',
              })
              return
            }

            const device = start.data

            openBrowser(device.url)
            void context.ui.dialog.alert({
              message: buildLoginPrompt(device.url, device.user_code),
              title: 'Login to curl.md',
            })

            const abortController = new AbortController()
            loginAbortController = abortController

            try {
              const result = await curlmdInternal.Auth.waitForLogin(baseUrl, device, {
                signal: abortController.signal,
              })

              context.ui.dialog.clear()
              if (!result.ok) {
                context.ui.toast.show({
                  message: `Failed to log in: ${result.error.message}`,
                  title: 'curl.md',
                  variant: 'error',
                })
                return
              }

              context.ui.toast.show({
                duration: authStatusToastDurationMs,
                message: buildLoginSuccessMessage(result.data.login),
                title: 'curl.md',
                variant: 'success',
              })
            } catch (error) {
              if (abortController.signal.aborted) return

              context.ui.dialog.clear()
              context.ui.toast.show({
                message: error instanceof Error ? error.message : 'Failed to log in.',
                title: 'curl.md',
                variant: 'error',
              })
            } finally {
              if (loginAbortController === abortController) loginAbortController = null
            }
          },
        },
        {
          id: 'curlmd.logout',
          title: 'Log out',
          group: 'curl.md',
          palette: true,
          slash: { name: 'curl_md_logout' },
          run: async () => {
            context.ui.dialog.clear()

            if (!curlmdInternal.Session.read(baseUrl)) {
              context.ui.toast.show({
                duration: authStatusToastDurationMs,
                message: buildAlreadyLoggedOutMessage(),
                title: 'curl.md',
                variant: 'info',
              })
              return
            }

            const result = await curlmdInternal.Auth.logout(baseUrl)
            if (!result.ok) {
              context.ui.toast.show({
                message: `Failed to log out: ${result.error.message}`,
                title: 'curl.md',
                variant: 'error',
              })
              return
            }

            context.ui.toast.show({
              duration: authStatusToastDurationMs,
              message: buildLogoutSuccessMessage(result.data.login),
              title: 'curl.md',
              variant: 'info',
            })
          },
        },
        {
          id: 'curlmd.org',
          title: 'Switch organization',
          group: 'curl.md',
          palette: true,
          slash: { name: 'curl_md_org' },
          run: async () => {
            const authHeaders = await resolver()
            if (!authHeaders) {
              context.ui.dialog.clear()
              context.ui.toast.show({
                duration: authStatusToastDurationMs,
                message: 'Not authenticated. Run /curl_md_login first.',
                title: 'curl.md',
                variant: 'error',
              })
              return
            }

            const client = curlmd.createClient(baseUrl, { headers: createHeaders(authHeaders) })
            const [orgsRes, meRes] = await Promise.all([
              client.api.orgs.$get(),
              client.api.auth.me.$get(),
            ])

            if (orgsRes.status !== 200 || meRes.status !== 200) {
              context.ui.dialog.clear()
              context.ui.toast.show({
                message: 'Failed to fetch organizations.',
                title: 'curl.md',
                variant: 'error',
              })
              return
            }

            const orgsJson = await orgsRes.json()
            const meJson = await meRes.json()
            if (!meJson.account) {
              context.ui.dialog.clear()
              context.ui.toast.show({
                duration: authStatusToastDurationMs,
                message: 'Not authenticated. Run /curl_md_login first.',
                title: 'curl.md',
                variant: 'error',
              })
              return
            }

            const currentOrgId = curlmdInternal.Session.read(baseUrl)?.organization_id
            const accountLogin = meJson.account.login || 'account'
            const options: { description: string; title: string; value: OrgChoice }[] = [
              {
                description: currentOrgId ? 'Use personal account' : 'Current account',
                title: accountLogin,
                value: {
                  id: undefined,
                  kind: 'account' as const,
                  label: accountLogin,
                },
              },
              ...orgsJson.organizations.map((organization) => ({
                description:
                  organization.id === currentOrgId
                    ? 'Current organization'
                    : 'Switch to organization',
                title: organization.login,
                value: {
                  id: organization.id,
                  kind: 'organization' as const,
                  label: organization.login,
                },
              })),
            ]

            const choice = await context.ui.dialog.select<OrgChoice>({
              current: options.find((option) =>
                currentOrgId ? option.value.id === currentOrgId : option.value.kind === 'account',
              )?.value,
              options,
              placeholder: 'Choose account or organization',
              title: 'Switch organization',
            })
            if (!choice) return

            curlmdInternal.Session.write({ organization_id: choice.id }, baseUrl)
            context.ui.toast.show({
              duration: authStatusToastDurationMs,
              message: buildOrgSwitchMessage(choice.kind, choice.label),
              title: 'curl.md',
              variant: 'info',
            })
          },
        },
        {
          id: 'curlmd.status',
          title: 'Show status',
          group: 'curl.md',
          palette: true,
          slash: { name: 'curl_md_status' },
          run: async () => {
            context.ui.dialog.clear()

            const lines = [`${packageJson.name} v${packageJson.version}`]
            const cliDisplay = findCliPath() || 'not installed'
            const authHeaders = await resolver()
            if (!authHeaders) {
              lines.push('Auth: Not authenticated. Run /curl_md_login or set CURLMD_API_KEY.')
              lines.push('Tool: curl_md')
              lines.push(`CLI: ${cliDisplay}`)
              if (baseUrl !== curlmd.defaultBaseUrl) lines.push(`Base URL: ${baseUrl}`)
              context.ui.toast.show({
                duration: statusToastDurationMs,
                message: lines.join('\n'),
                title: 'curl.md',
                variant: 'info',
              })
              return
            }

            const authType = apiKey ? 'api_key' : 'session'
            const status = await readStatus(
              baseUrl,
              authHeaders.authorization,
              authHeaders.organization_id,
            )
            if (status.type === 'authenticated') {
              lines.push(`Auth: ${authType} (${status.login})`)
              lines.push(`Organization: ${status.organization}`)
            } else if (status.type === 'unauthenticated') {
              lines.push(
                authType === 'api_key'
                  ? 'Auth: api_key not authenticated. Refresh CURLMD_API_KEY.'
                  : 'Auth: session not authenticated. Run /curl_md_login or set CURLMD_API_KEY.',
              )
            } else {
              lines.push(`Auth: ${authType} verification failed. ${status.message}`)
            }

            lines.push('Tool: curl_md')
            lines.push(`CLI: ${cliDisplay}`)
            if (baseUrl !== curlmd.defaultBaseUrl) lines.push(`Base URL: ${baseUrl}`)
            context.ui.toast.show({
              duration: statusToastDurationMs,
              message: lines.join('\n'),
              title: 'curl.md',
              variant: 'info',
            })
          },
        },
      ],
    }))

    return () => loginAbortController?.abort()
  },
}

export default tuiPlugin
