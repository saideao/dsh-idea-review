/**
 * Run one child process and capture its output.
 *
 * The plugin shells out to the idea-review skill scripts shipped in `skill/`.
 * Nothing here depends on a Harness package: only `node:` builtins, because the
 * bundle is installed into a profile whose module resolution cannot see the dsh
 * installation's packages.
 */
import { spawn } from 'node:child_process'

/** Keep a runaway script from flooding the model's context. */
const MAX_OUTPUT_CHARS = 60_000

/**
 * @param {object} options
 * @param {string} options.command - executable, optionally with a prefix (`uv run`)
 * @param {string[]} options.args - arguments appended after the prefix
 * @param {string} [options.cwd]
 * @param {Record<string, string>} [options.env] - extra environment entries
 * @param {number} [options.timeoutMs]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ code: number, stdout: string, stderr: string, timedOut: boolean, spawnError: boolean }>}
 */
export function runCommand(options) {
  const parts = String(options.command ?? '')
    .split(/\s+/)
    .filter(Boolean)
  const executable = parts[0]
  const argv = [...parts.slice(1), ...(options.args ?? [])]
  return new Promise(resolve => {
    if (!executable) {
      resolve({ code: -1, stdout: '', stderr: '没有配置要执行的命令（config.python）', timedOut: false, spawnError: true })
      return
    }
    let child
    try {
      child = spawn(executable, argv, {
        cwd: options.cwd,
        env: { ...process.env, ...(options.env ?? {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolve({ code: -1, stdout: '', stderr: describeSpawnFailure(executable, error), timedOut: false, spawnError: true })
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false

    const timer =
      options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true
            child.kill('SIGKILL')
          }, options.timeoutMs)
        : undefined

    const onAbort = () => {
      timedOut = false
      child.kill('SIGKILL')
    }
    if (options.signal) {
      if (options.signal.aborted) onAbort()
      else options.signal.addEventListener('abort', onAbort, { once: true })
    }

    const finish = result => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (options.signal) options.signal.removeEventListener('abort', onAbort)
      resolve({
        code: result.code,
        stdout: clip(stdout),
        stderr: clip(stderr),
        timedOut,
        spawnError: false,
      })
    }

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', chunk => {
      if (stdout.length < MAX_OUTPUT_CHARS * 2) stdout += chunk
    })
    child.stderr?.on('data', chunk => {
      if (stderr.length < MAX_OUTPUT_CHARS * 2) stderr += chunk
    })
    child.on('error', error => {
      stderr += describeSpawnFailure(executable, error)
      finish({ code: -1 })
    })
    child.on('close',(code, signal) => {
      if (signal && timedOut) stderr += `\n(超时，已终止：${signal})`
      finish({ code: typeof code === 'number' ? code : -1 })
    })
  })
}

function clip(text) {
  const value = String(text ?? '')
  if (value.length <= MAX_OUTPUT_CHARS) return value
  const head = value.slice(0, Math.floor(MAX_OUTPUT_CHARS * 0.75))
  const tail = value.slice(-Math.floor(MAX_OUTPUT_CHARS * 0.2))
  return `${head}\n…（输出太长，已省略中间部分）…\n${tail}`
}

function describeSpawnFailure(executable, error) {
  const code = error?.code
  if (code === 'ENOENT') {
    return `找不到可执行文件 ${executable}。请安装它，或在插件配置里把 python 指向可用的解释器（例如 "uv run" 或 python3 的绝对路径）。`
  }
  if (code === 'EACCES') return `没有执行 ${executable} 的权限。`
  return String(error?.message ?? error)
}
