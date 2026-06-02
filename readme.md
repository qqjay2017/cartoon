export FLARESOLVERR_URL=http://127.0.0.1:8191
export NO_PROXY=localhost,127.0.0.1   # 重要：避免 FlareSolverr 请求走 HTTP_PROXY
# 保留你原来的代理
export HTTP_PROXY=http://127.0.0.1:10808
export HTTPS_PROXY=http://127.0.0.1:10808
pnpm dev:server
export FLARESOLVERR_PROXY=http://172.17.0.1:10808