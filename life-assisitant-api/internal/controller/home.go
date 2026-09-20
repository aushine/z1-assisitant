package controller

import (
	"github.com/gogf/gf/v2/net/ghttp"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/response"
	"github.com/life-assistant/api/internal/service"
)

// HomeController 首页聚合控制器
type HomeController struct{}

var Home = &HomeController{}

// Fetch GET /api/v1/home
func (c *HomeController) Fetch(r *ghttp.Request) {
	uid := r.GetCtxVar("user_id").String()
	if uid == "" {
		response.Error(r, ecode.AuthTokenMissing)
		return
	}
	out, err := service.Home().Fetch(r.Context())
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}
