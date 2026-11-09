/**
 * dsh-go-delete-conversation — host half.
 *
 * 给 dsh-go 手机 App 的会话长按菜单加一项「删除会话」，点它 → 确认 → 真正删掉。
 * 删除范围与会话存储保持一致：
 *   1. `$DSH_HOME/sessions/<project>/<sessionId>` 整个日志目录；
 *   2. `$DSH_HOME/storages/session_projcache/sessions/<sessionId>.json` 投影缓存；
 *   3. workspace.json 里的工作区归属与归档标记（走活的 WorkspaceRegistry）。
 * 正在跑回合的会话拒绝删除。
 *
 * @module dsh-go-delete-conversation
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path'

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const SESSIONS_DIR = join(DSH_HOME, 'sessions')
const PROJCACHE_DIR = join(DSH_HOME, 'storages', 'session_projcache', 'sessions')
const WORKSPACE_FILE = join(DSH_HOME, 'storages', 'workspace.json')
const PLUGIN_DIR = join(DSH_HOME, 'dsh-go', 'plugins', 'dsh-go-delete-conversation')
/** 浏览器半边调用的删除路由。 */
const DELETE_PATH = '/dsh-go-delete-conversation/delete'

/**
 * 长按菜单「归档」是否连带着真删。
 * 现在有了正经的「删除会话」菜单项，归档就该只是归档，所以这个钩子默认关闭；
 * 还想让归档即删的话，在插件目录放一个 archive-deletes.on 文件。
 * @returns {boolean} true 表示归档即删除
 */
function archiveDeletes() {
  try {
    return existsSync(join(PLUGIN_DIR, 'archive-deletes.on'))
  } catch {
    return false
  }
}

/**
 * 目录总量。
 * @param {string} dir 目录
 * @returns {number} 字节
 */
function dirSize(dir) {
  let total = 0
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    try {
      if (entry.isDirectory()) total += dirSize(full)
      else total += statSync(full).size
    } catch {}
  }
  return total
}

/**
 * 工作区里记着这个会话的 id。
 * @param {string} sid 会话 id
 * @returns {string[]} 工作区 id
 */
function workspaceIdsOwning(sid) {
  let state
  try {
    state = JSON.parse(readFileSync(WORKSPACE_FILE, 'utf8'))
  } catch {
    return []
  }
  const tables = state?.tables?.workspaces
  if (tables === null || typeof tables !== 'object') return []
  return Object.entries(tables)
    .filter(([, record]) => Array.isArray(record?.sessionIds) && record.sessionIds.includes(sid))
    .map(([id]) => id)
}

/**
 * 从工作区摘掉这个会话。
 * @param {any} ctx 宿主上下文
 * @param {string} sid 会话 id
 * @returns {Promise<string[]>} 处理过的工作区 id
 */
async function detachFromWorkspaces(ctx, sid) {
  const done = []
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined) return done
  for (const workspaceId of workspaceIdsOwning(sid)) {
    try {
      const workspace = registry.get(workspaceId)
      if (workspace === undefined) continue
      await workspace.detachSession(sid)
      done.push(workspaceId)
    } catch {}
  }
  try {
    await registry.unarchiveSession(sid)
  } catch {}
  return done
}

/**
 * 这个会话是不是正在跑回合。
 * @param {any} ctx 宿主上下文
 * @param {string} sid 会话 id
 * @returns {boolean} 正在跑
 */
function isRunning(ctx, sid) {
  try {
    return ctx.get('agents')?.get(sid)?.status === 'running'
  } catch {
    return false
  }
}

/**
 * 把加载中的会话从本进程摘掉，否则侧边栏刷新会把它放回来。
 * @param {any} ctx 宿主上下文
 * @param {string} sid 会话 id
 * @param {any} session 活的会话对象
 * @returns {number} 摘掉了几处登记
 */
function unloadLive(ctx, sid, session) {
  try {
    ctx.emit('session/disposed', session)
  } catch {}
  let removed = 0
  for (const serviceName of ['sessions', 'agents']) {
    try {
      const store = ctx.get(serviceName)?.store
      if (store instanceof Map && store.delete(sid)) removed += 1
    } catch {}
  }
  return removed
}

/**
 * 真正删除一个会话。
 * @param {any} ctx 宿主上下文
 * @param {string} sid 会话 id
 * @returns {Promise<{existed:boolean,size:number}>} 结果
 * @throws {Error} 会话在跑或文件删不掉时
 */
async function deleteSession(ctx, sid, options = {}) {
  if (!/^[A-Za-z0-9-]{6,80}$/.test(sid)) throw new Error('会话 id 不合法')
  if (isRunning(ctx, sid)) {
    // 归档刚停掉的会话，状态位要过一会儿才落地；等它一下，别急着报错。
    let waited = 0
    while (isRunning(ctx, sid) && waited < 3000) {
      await new Promise((resolve) => setTimeout(resolve, 300))
      waited += 300
    }
    if (isRunning(ctx, sid)) throw new Error('这个会话正在跑，等它跑完再删')
  }
  const live = (() => {
    try {
      return ctx.get('sessions')?.get(sid)
    } catch {
      return undefined
    }
  })()
  if (live !== undefined) unloadLive(ctx, sid, live)
  const dirs = []
  let size = 0
  try {
    for (const project of readdirSync(SESSIONS_DIR, { withFileTypes: true })) {
      if (!project.isDirectory()) continue
      const candidate = join(SESSIONS_DIR, project.name, sid)
      if (!existsSync(candidate)) continue
      dirs.push(candidate)
      size += dirSize(candidate)
    }
  } catch {}
  const cacheFile = join(PROJCACHE_DIR, `${sid}.json`)
  const hadCache = existsSync(cacheFile)
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  if (hadCache) {
    try {
      unlinkSync(cacheFile)
    } catch {}
  }
  await detachFromWorkspaces(ctx, sid)
  try {
    ctx.emit('api-session/removed', sid)
  } catch {}
  return { existed: dirs.length > 0 || hadCache, size }
}

/**
 * 只信任本机回环、且不是经代理转发、且 connection 服务认可的请求。
 * @param {any} ctx 宿主上下文
 * @param {any} request node 请求
 * @returns {boolean} 可信
 */
function trustedRequest(ctx, request) {
  const address = request.socket?.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  if (
    request.headers.forwarded !== undefined ||
    request.headers['x-forwarded-for'] !== undefined ||
    request.headers['x-real-ip'] !== undefined
  ) {
    return false
  }
  try {
    return ctx.connection?.requestRejection?.(request) === undefined
  } catch {
    return false
  }
}

/**
 * 回一个 JSON。
 * @param {any} response node 响应
 * @param {number} status 状态码
 * @param {any} value 内容
 */
function writeJson(response, status, value) {
  response.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

/**
 * 读一个有小上限的 JSON 请求体；过界的只有会话 id。
 * @param {any} request node 请求
 * @returns {Promise<any>} 解析结果
 */
async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 8192) throw new Error('请求体太大')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export const name = 'dsh-go-delete-conversation'

/**
 * 插件主体。只在装了 dsh-go 桥的宿主上注册。
 * @param {any} ctx 宿主上下文
 */
export function apply(ctx) {
  // 注入出来的子作用域只有注入进去的服务；宿主服务（agents / sessions / workspaceRegistry）
  // 要走未被遮蔽的根上下文去取。
  const host = ctx
  // 浏览器半边（会话长按菜单里的「删除会话」）需要一个宿主路由来真删。
  // 下面那个「归档」钩子是备选：想让长按 → 归档 也顺带真删，
  // 就在插件目录放一个 archive-deletes.on 文件。
  ctx.inject(['webServer', 'connection'], (wctx) => {
    try {
      ctx.effect(
        () =>
          wctx.webServer.register({
            kind: 'exact',
            path: DELETE_PATH,
            handler(request, response) {
              if (request.method !== 'POST') {
                writeJson(response, 405, { ok: false, error: '只接受 POST' })
                return
              }
              if (!trustedRequest(wctx, request)) {
                writeJson(response, 403, { ok: false, error: '只允许本机同源请求' })
                return
              }
              void (async () => {
                try {
                  const body = await readJsonBody(request)
                  const sid = typeof body.sessionId === 'string' ? body.sessionId : ''
                  const result = await deleteSession(host, sid)
                  writeJson(response, 200, { ok: true, ...result })
                } catch (error) {
                  const message = error instanceof Error ? error.message : String(error)
                  writeJson(response, 400, { ok: false, error: message })
                }
              })()
            }
          }),
        'dsh-go-delete-conversation: delete route'
      )
    } catch {}
  })
  ctx.inject(['workspaceRegistry'], (wctx) => {
    try {
      const registry = wctx.workspaceRegistry
      if (registry === undefined || registry === null) return
      if (registry.__fjArchiveHooked === true) return
      const original = registry.archiveSession
      if (typeof original !== 'function') return
      Object.defineProperty(registry, '__fjArchiveHooked', { value: true, enumerable: false })
      registry.archiveSession = async function patchedArchive(sessionId, options) {
        const result = await original.call(this, sessionId, options)
        try {
          if (archiveDeletes()) await deleteSession(host, sessionId)
        } catch {}
        return result
      }
    } catch {
      // 宿主对象被冻结之类的情况：只保留长按菜单那条路，不影响其它功能。
    }
  })
}
