package controller

import (
	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"

	"github.com/life-assistant/api/internal/response"
	"github.com/life-assistant/api/internal/utility"
)

// AppController 应用级公开配置（无需登录，前端启动时探测）
type AppController struct{}

var App = &AppController{}

// UploadsBase GET /z1/api/v1/app/uploads-base
// 下发上传文件对外访问基址（storage.public_url，可选配置）：
//   - 配置了（如 http://192.168.101.75 或 https://voz21.cn）→ 前端用它拼 /z1/uploads/* 的绝对地址
//   - 留空 → 前端回落「当前连接的后端」（同源静态映射 / vite proxy）
//
// 典型场景：本地起后端连线上同一套库时，DB 里的头像 URL 一样，但文件字节只在
// 部署机磁盘上 —— 前端拿到基址后直接从部署机取图，测试环境不再 404。
// 是否可达由前端自行探活（超时/失败回落同源），后端只如实下发配置值。
func (c *AppController) UploadsBase(r *ghttp.Request) {
	response.Success(r, g.Map{
		"uploads_base_url": utility.PublicBaseURL(r.Context()),
	})
}
