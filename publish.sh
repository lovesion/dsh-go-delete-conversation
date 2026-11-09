#!/bin/sh
# 一条命令发布 dsh-go-delete-conversation 到 npm。
#
# 用法（在你自己的电脑上，不是在手机上）：
#   1. 去 https://www.npmjs.com/settings/~/tokens 建一个 Automation token
#   2. 把 token 贴进下面这行，或者直接 export NPM_TOKEN=...
#   3. sh publish.sh
#
# token 用一次就作废，发完去 npm 后台把它 revoke 掉。

set -e
[ -n "$NPM_TOKEN" ] || { echo "缺 NPM_TOKEN，先 export NPM_TOKEN=npm_xxxx"; exit 1; }

cd "$(dirname "$0")"

# npm 只认 .npmrc 里的 authToken，不接受环境变量直传
printf '//registry.npmjs.org/:_authToken=%s\n' "$NPM_TOKEN" > .npmrc
trap 'rm -f .npmrc' EXIT INT TERM

echo "==> 当前账号"
npm whoami --registry=https://registry.npmjs.org

echo "==> 检查包名没被占"
npm view dsh-go-delete-conversation version 2>/dev/null && { echo "包名已被占用"; exit 1; } || echo "名字空着，可以用"

echo "==> 发布"
npm publish --registry=https://registry.npmjs.org --access public

echo
echo "==> 完成。验证："
echo "    npm view dsh-go-delete-conversation"
echo
echo "插件市场每天自动爬带 dsh-plugin 关键词的包，"
echo "最多一天后它会自己出现在市场的货架上，不用另外提交。"
