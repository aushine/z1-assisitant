// 生活助手后端 API 入口
// 启动：go mod tidy && go run cmd/server/main.go
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"

	"github.com/life-assistant/api/internal/consts"
	"github.com/life-assistant/api/internal/controller"
	"github.com/life-assistant/api/internal/dao"
	"github.com/life-assistant/api/internal/middleware"
	"github.com/life-assistant/api/internal/service"
	// 显式 import 触发 init()，注册所有 service 实现
	_ "github.com/life-assistant/api/internal/service/impl"
	"github.com/life-assistant/api/internal/utility"
)

func main() {
	ctx := context.Background()

	// 1. 初始化 MySQL
	dsn := g.Cfg().MustGet(ctx, "database.default.link").String()
	dbDebug := g.Cfg().MustGet(ctx, "database.default.debug", true).Bool()
	if err := dao.InitDB(dsn, dbDebug); err != nil {
		log.Fatalf("MySQL 初始化失败: %v", err)
	}
	fmt.Println("✅ MySQL 连接成功")

	// 2. Redis：v1 暂不用，老大要求用变量缓存代替
	redisEnabled := g.Cfg().MustGet(ctx, "redis.default.enabled", false).Bool()
	if !redisEnabled {
		fmt.Println("ℹ️  Redis 已禁用，v1 阶段使用进程内变量缓存")
	}

	// 3. 加载 JWT 配置
	utility.LoadConfig(utility.JWTConfig{
		AccessSecret:  g.Cfg().MustGet(ctx, "jwt.accessSecret").String(),
		RefreshSecret: g.Cfg().MustGet(ctx, "jwt.refreshSecret").String(),
		AccessTTL:     g.Cfg().MustGet(ctx, "jwt.accessTtl").Int(),
		RefreshTTL:    g.Cfg().MustGet(ctx, "jwt.refreshTtl").Int(),
		Issuer:        g.Cfg().MustGet(ctx, "jwt.issuer").String(),
	})

	// 4. service.Auth 在上面 import 时已经通过 impl.init() 注入，触发空引用以避免未使用
	_ = service.Auth

	// 5. 创建 HTTP Server
	s := g.Server()
	addr := g.Cfg().MustGet(ctx, "server.address", ":8080").String()
	s.SetAddr(addr)

	// 6. 全局中间件链
	s.Use(
		middleware.RequestId,    // 1. 请求 ID
		middleware.CORS,         // 2. 跨域
		middleware.Recovery,     // 3. panic 恢复
		middleware.AccessLog,    // 4. 访问日志
		middleware.UTF8,         // 5. 强制 UTF-8 响应头（中文不乱码）
		middleware.ErrorHandler, // 6. 统一错误处理
		middleware.JwtAuth,      // 7. JWT 鉴权（白名单放行）
	)

	// 7. 文件存储（D-03 第八轮）：建目录 + 静态映射 /z1/uploads → storage.upload_dir
	//    Windows/Linux 原生路径均可（filepath 处理，配置见 manifest/config/config.yaml）
	//    D-03 第十三轮：统一 /z1 服务前缀（nginx 单 location 即可代理 API+静态，不与他服务重名）
	if err := utility.InitStorage(ctx); err != nil {
		log.Fatalf("上传目录初始化失败: %v", err)
	}
	s.AddStaticPath(consts.UploadsPrefix, utility.UploadRoot(ctx))

	// 8. 注册业务路由
	controller.RegisterRoutes(s)

	// 9. 优雅关闭
	go gracefulShutdown(s)

	// 10. 启动
	fmt.Printf("🚀 life-assistant-api starting on %s ...\n", addr)
	s.Run()
}

// gracefulShutdown 监听 SIGINT/SIGTERM 优雅关闭
func gracefulShutdown(s *ghttp.Server) {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh
	fmt.Println()
	fmt.Println("收到关闭信号，开始优雅关闭...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = s.Shutdown()
	_ = ctx
	_ = dao.CloseDB()
	fmt.Println("已关闭，Bye 👋")
	os.Exit(0)
}
