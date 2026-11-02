import * as childProcess from 'node:child_process'
import * as os from 'node:os'
import * as curlmd from 'curl.md'
import { createHeaders, formatApiError, parseApiError } from './utils.ts'

export type OrgChoice = {
  id: string | undefined
  kind: 'account' | 'organization'
  label: string
}

export function buildAlreadyAuthenticatedMessage(login: string | null) {
  if (!login) return withApiKeyNote('Already logged in.')
  return withApiKeyNote(`Already logged in as ${login}.`)
}

export function buildAlreadyLoggedOutMessage() {
  return withApiKeyNote('Already logged out.')
}

export function buildOrgSwitchMessage(kind: 'account' | 'organization', label: string) {
  if (kind === 'account') return withApiKeyNote(`Switched account to ${label}.`)
  return withApiKeyNote(`Switched organization to ${label}.`)
}

export function buildLoginPrompt(url: string, userCode: string) {
  return [
    'Complete authentication in your browser.',
    '',
    `Confirmation code: ${userCode}`,
    `URL: ${url}`,
    '',
    'This dialog closes automatically when login completes.',
  ].join('\n')
}

export function buildLoginSuccessMessage(login: string | null) {
  if (!login) return withApiKeyNote('Logged in.')
  return withApiKeyNote(`Logged in as ${login}.`)
}

export function buildLogoutSuccessMessage(login: string | null) {
  if (!login) return withApiKeyNote('Logged out.')
  return withApiKeyNote(`Logged out of ${login}.`)
}

export function findCliPath() {
  const result = childProcess.spawnSync(
    process.platform === 'win32' ? 'where' : 'which',
    ['curl.md'],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  )
  if (result.error || result.status !== 0) return null

  const cliPath = result.stdout.split(/\r?\n/).find(Boolean)?.trim()
  return cliPath ? formatPathForDisplay(cliPath) : null
}

export function formatPathForDisplay(value: string) {
  const homeDir = os.homedir()
  if (value === homeDir) return '~'
  if (value.startsWith(`${homeDir}/`)) return `~${value.slice(homeDir.length)}`
  return value
}

export function openBrowser(url: string) {
  try {
    const child = (() => {
      if (process.platform === 'win32')
        return childProcess.spawn('cmd', ['/c', 'start', '', url], {
          detached: true,
          stdio: 'ignore',
        })
      if (process.platform === 'darwin')
        return childProcess.spawn('open', [url], { detached: true, stdio: 'ignore' })
      return childProcess.spawn('xdg-open', [url], { detached: true, stdio: 'ignore' })
    })()

    child.once('error', () => undefined)
    child.unref()
  } catch {}
}

export async function readStatus(
  baseUrl: string,
  authorization: string,
  organizationId: string | null,
) {
  try {
    const client = curlmd.createClient(baseUrl, {
      headers: createHeaders({
        authorization,
        expires_at: null,
        organization_id: null,
      }),
    })
    const res = await client.api.auth.me.$get()
    if (res.status !== 200) {
      const json = await res.json().catch(() => undefined)
      const error = parseApiError(json)
      return {
        message: error ? formatApiError(error) : `status ${res.status}`,
        type: 'error' as const,
      }
    }

    const json = await res.json()
    if (!json.account) return { type: 'unauthenticated' as const }

    const activeOrganization = organizationId
      ? json.account.organizations?.find((organization) => organization.id === organizationId)
      : null
    return {
      login: json.account.login,
      organization: activeOrganization?.login ?? 'none',
      type: 'authenticated' as const,
    }
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : 'unknown error',
      type: 'error' as const,
    }
  }
}

export function withApiKeyNote(message: string) {
  if (!process.env.CURLMD_API_KEY) return message
  return `${message} CURLMD_API_KEY still overrides plugin requests.`
}
