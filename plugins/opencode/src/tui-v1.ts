import type * as opencodePluginTui from '@opencode-ai/plugin/tui'
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

export const tuiPlugin: opencodePluginTui.TuiPluginModule = {
  id: '@curl.md/opencode',
  async tui(api: opencodePluginTui.TuiPluginApi) {
    const baseUrl = process.env.CURLMD_BASE_URL || curlmd.defaultBaseUrl
    const apiKey = process.env.CURLMD_API_KEY
    let loginAbortController: AbortController | null = null
    const resolver = curlmdInternal.Auth.createResolver(baseUrl, apiKey)

    api.lifecycle.onDispose(() => loginAbortController?.abort())

    api.command.register(() => [
      {
        category: 'curl.md',
        onSelect: async () => {
          if (loginAbortController) {
            api.ui.toast({
              message: 'Login already in progress.',
              title: 'curl.md',
              variant: 'info',
            })
            return
          }

          const start = await curlmdInternal.Auth.startLogin(baseUrl)
          if (!start.ok) {
            api.ui.toast({
              message: `Failed to log in: ${start.error.message}`,
              title: 'curl.md',
              variant: 'error',
            })
            return
          }

          if (start.data.kind === 'already_authenticated') {
            api.ui.dialog.clear()
            api.ui.toast({
              duration: authStatusToastDurationMs,
              message: buildAlreadyAuthenticatedMessage(start.data.login),
              title: 'curl.md',
              variant: 'info',
            })
            return
          }

          const device = start.data

          openBrowser(device.url)
          api.ui.dialog.replace(() =>
            api.ui.DialogAlert({
              message: buildLoginPrompt(device.url, device.user_code),
              title: 'Login to curl.md',
            }),
          )

          const abortController = new AbortController()
          loginAbortController = abortController

          try {
            const result = await curlmdInternal.Auth.waitForLogin(baseUrl, device, {
              signal: abortController.signal,
            })

            api.ui.dialog.clear()
            if (!result.ok) {
              api.ui.toast({
                message: `Failed to log in: ${result.error.message}`,
                title: 'curl.md',
                variant: 'error',
              })
              return
            }

            api.ui.toast({
              duration: authStatusToastDurationMs,
              message: buildLoginSuccessMessage(result.data.login),
              title: 'curl.md',
              variant: 'success',
            })
          } catch (error) {
            if (abortController.signal.aborted) return

            api.ui.dialog.clear()
            api.ui.toast({
              message: error instanceof Error ? error.message : 'Failed to log in.',
              title: 'curl.md',
              variant: 'error',
            })
          } finally {
            if (loginAbortController === abortController) loginAbortController = null
          }
        },
        slash: { name: 'curl_md_login' },
        suggested: true,
        title: 'Log in',
        value: 'curlmd.login',
      },
      {
        category: 'curl.md',
        onSelect: async () => {
          api.ui.dialog.clear()

          if (!curlmdInternal.Session.read(baseUrl)) {
            api.ui.toast({
              duration: authStatusToastDurationMs,
              message: buildAlreadyLoggedOutMessage(),
              title: 'curl.md',
              variant: 'info',
            })
            return
          }

          const result = await curlmdInternal.Auth.logout(baseUrl)
          if (!result.ok) {
            api.ui.toast({
              message: `Failed to log out: ${result.error.message}`,
              title: 'curl.md',
              variant: 'error',
            })
            return
          }

          api.ui.toast({
            duration: authStatusToastDurationMs,
            message: buildLogoutSuccessMessage(result.data.login),
            title: 'curl.md',
            variant: 'info',
          })
        },
        slash: { name: 'curl_md_logout' },
        title: 'Log out',
        value: 'curlmd.logout',
      },
      {
        category: 'curl.md',
        onSelect: async () => {
          const authHeaders = await resolver()
          if (!authHeaders) {
            api.ui.dialog.clear()
            api.ui.toast({
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
            api.ui.dialog.clear()
            api.ui.toast({
              message: 'Failed to fetch organizations.',
              title: 'curl.md',
              variant: 'error',
            })
            return
          }

          const orgsJson = await orgsRes.json()
          const meJson = await meRes.json()
          if (!meJson.account) {
            api.ui.dialog.clear()
            api.ui.toast({
              duration: authStatusToastDurationMs,
              message: 'Not authenticated. Run /curl_md_login first.',
              title: 'curl.md',
              variant: 'error',
            })
            return
          }

          const currentOrgId = curlmdInternal.Session.read(baseUrl)?.organization_id
          const accountLogin = meJson.account.login || 'account'
          const options: opencodePluginTui.TuiDialogSelectOption<OrgChoice>[] = [
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

          api.ui.dialog.replace(() =>
            api.ui.DialogSelect({
              onSelect(option) {
                curlmdInternal.Session.write({ organization_id: option.value.id }, baseUrl)
                api.ui.dialog.clear()
                api.ui.toast({
                  duration: authStatusToastDurationMs,
                  message: buildOrgSwitchMessage(option.value.kind, option.value.label),
                  title: 'curl.md',
                  variant: 'info',
                })
              },
              options,
              placeholder: 'Choose account or organization',
              title: 'Switch organization',
            }),
          )
        },
        slash: { name: 'curl_md_org' },
        title: 'Switch organization',
        value: 'curlmd.org',
      },
      {
        category: 'curl.md',
        onSelect: async () => {
          api.ui.dialog.clear()

          const lines = [`${packageJson.name} v${packageJson.version}`]
          const cliDisplay = findCliPath() || 'not installed'
          const authHeaders = await resolver()
          if (!authHeaders) {
            lines.push('Auth: Not authenticated. Run /curl_md_login or set CURLMD_API_KEY.')
            lines.push('Tool: curl_md')
            lines.push(`CLI: ${cliDisplay}`)
            if (baseUrl !== curlmd.defaultBaseUrl) lines.push(`Base URL: ${baseUrl}`)
            api.ui.toast({
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
          api.ui.toast({
            duration: statusToastDurationMs,
            message: lines.join('\n'),
            title: 'curl.md',
            variant: 'info',
          })
        },
        slash: { name: 'curl_md_status' },
        title: 'Show status',
        value: 'curlmd.status',
      },
    ])
  },
}

export default tuiPlugin
