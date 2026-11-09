# dsh-go-delete-conversation

**dsh-go 手机 App 专用插件。** 给 dsh-go 会话列表的长按菜单补一项「删除会话」，点了就真删。

它服务的是 **dsh-go**（装在手机上的那个 App），不是桌面/CLI 版的 dsh。判断标准很简单：
插件的目标场景是「在手机上长按一个会话、把它删掉」，入口和交互都是按 dsh-go 的手机界面设计的。

## 为什么它只能给 dsh-go 用

dsh-go 把 DSH 引擎跑在手机本地，界面外壳是 Flutter，会话列表、长按菜单这些位置由 dsh-go 通过
`$DSH_HOME/cache/dsh-go-bridge/occupancy.json` 记录自己渲染了哪些 Web 插槽。本插件正是挂在其中
`sidebar.workspaces.session.menu.item` 这个插槽上的 —— **dsh-go 渲染它，菜单项才会出现**。
桌面版 dsh 载入同一个包也不会有这个位置，装了没地方显示，所以它不是通用插件。

## 它做什么

在 dsh-go 的会话列表里长按（或点每条右边的「…」）打开菜单，里面会多一行 **删除会话**，
位置紧跟在官方「归档」后面。点它 → 弹确认框 → 确认即永久删除，然后：

1. 删掉 `$DSH_HOME/sessions/<项目>/<会话id>/` 整个日志目录；
2. 删掉 `$DSH_HOME/storages/session_projcache/sessions/<会话id>.json` 投影缓存；
3. 从 workspace.json 的工作区归属和归档列表里摘掉它（走活的 `WorkspaceRegistry`，不裸改文件）；
4. 广播 `api-session/removed`，让其它开着的客户端立刻把那一行去掉。

正在跑回合的会话会被拒绝。删了不可恢复。

## 菜单项是怎么进到手机上的

这一行来自 Web 客户端插槽 `sidebar.workspaces.session.menu.item`（官方 pin=100 / rename=200 /
fork=300 / archive=400 / session-id=450，本插件 order=420）。dsh-go 的 App 界面渲染的正是这套插槽，
所以手机上也能点到 —— 这一点和很多人的直觉相反，但 `$DSH_HOME/cache/dsh-go-bridge/occupancy.json`
里能直接看到这个 slot 的占用记录。

宿主半边负责真删：浏览器半边通过 `POST /dsh-go-delete-conversation/delete` 让宿主去动文件，
路由只接受本机回环、非代理转发、且被 connection 服务认可的请求。

## 「归档」保持原样

「归档」恢复成它本来的意思：只是藏起来，不删。想让归档连带着删，在插件目录放一个
`archive-deletes.on` 文件：

```sh
touch ~/.dsh/dsh-go/plugins/dsh-go-delete-conversation/archive-deletes.on
```

注意这是 `$DSH_HOME/dsh-go/plugins/` 下的那个目录，**不是装包的位置** ——
代码只认这里（见 `lib/index.js` 的 `PLUGIN_DIR`），放在 `node_modules` 里不生效。目录不存在就先建出来。

## 装（在 dsh-go 的内置终端里执行）

dsh-go 内部跑的就是 `web` 这个 profile，所以装法和 Web 插件一样。**这个包没有发布到 npm，
只能从本仓库获取** —— 下面两种方式任选一种。

先用 git 克隆下来，再装本地目录：

```sh
cd ~ && git clone https://github.com/lovesion/dsh-go-delete-conversation.git
dsh plugin --profile web add ~/dsh-go-delete-conversation
```

或者直接装 GitHub 上的 tarball：

```sh
dsh plugin --profile web add https://github.com/lovesion/dsh-go-delete-conversation/archive/refs/heads/main.tar.gz
```

已经在本地改代码调试时，指向工作目录即可：

```sh
dsh plugin --profile web add ./dsh-go-delete-conversation
```

装完重启一次 dsh-go 里的 DSH 引擎（App 里重开会话，或杀掉进程重进），长按菜单里就会出现。
装完在手机上点不到「删除会话」，多半是这次刷新还没生效：先确认 `dsh plugin --profile web list`
里有这个包，再重启一次引擎。

## 版本说明

- **0.2.0** 去掉了原生面板和输入框上方的「删会话」按钮，只保留长按菜单这一个入口。
  那两个入口在手机上要点好几层才能到，实际用起来碍事。
- **0.1.0** 首发版本，带原生面板。npm 上这一版随包的 README 把它描述成「走原生桥、不渲染 Web 插槽」，
  那是不准确的：实际入口一直是 Web 插槽，dsh-go 会渲染它。

## 安全边界

- 只删 `$DSH_HOME/sessions/` 底下、名字匹配 `^[A-Za-z0-9-]{6,80}$` 的目录，路径穿越在 id 校验处就挡掉；
- 不碰 `accounts.json`、配置文件、工作区数据以外的任何东西；
- 不联网，不上报，没有遥测。

## 许可

MIT
