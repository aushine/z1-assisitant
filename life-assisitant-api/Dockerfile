# ============================================
# life-assistant-api Dockerfile
# 多阶段构建：golang:1.22-alpine -> alpine:3.19
#
# 用法：
#   docker build -t life-assistant-api:latest .
#   docker build --build-arg CONFIG_FILE=config-smp.yaml -t life-assistant-api:smp .
# ============================================

# ---------- 阶段1：编译 ----------
FROM golang:1.22-alpine AS builder

WORKDIR /build

# 先拷贝依赖文件，利用 Docker 缓存
COPY go.mod go.sum ./
RUN go mod download

# 拷贝源码
COPY . .

# 编译（禁用 CGO，生成纯静态二进制）
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /app/api cmd/server/main.go

# ---------- 阶段2：运行 ----------
FROM alpine:3.19

# 时区 + ca证书（HTTPS 请求需要）
RUN apk add --no-cache tzdata ca-certificates \
    && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && echo "Asia/Shanghai" > /etc/timezone \
    && apk del tzdata

WORKDIR /app

# 从 builder 拷贝二进制
COPY --from=builder /app/api .

# 配置文件：可通过 --build-arg CONFIG_FILE=xxx.yaml 指定，默认 config.yaml
ARG CONFIG_FILE=config.yaml
COPY manifest/config/${CONFIG_FILE} manifest/config/config.yaml

# 创建日志目录
RUN mkdir -p logs

EXPOSE 8090

ENTRYPOINT ["./api"]
