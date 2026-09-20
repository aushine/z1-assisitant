package middleware

import (
	"github.com/gogf/gf/v2/errors/gcode"
	"github.com/gogf/gf/v2/errors/gerror"
	"github.com/gogf/gf/v2/net/ghttp"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/response"
)

// ErrorHandler 统一错误处理
// 在 controller 抛 error 时，把 gerror 还原成统一响应格式
// 注意：JWT 中间件已经直接 write 了响应，这里只兜底 controller 路径
func ErrorHandler(r *ghttp.Request) {
	r.Middleware.Next()

	if err := r.GetError(); err != nil {
		var bc ecode.BusinessCode

		// 尝试从 gerror 中提取我们定义的 BusinessCode
		if gerror.HasCode(err, &ecode.Success) { // 任意 BusinessCode 即可
			c := gerror.Code(err)
			if c != nil {
				// 如果是我们定义的 BusinessCode（实现 gcode.Code）
				if b, ok := c.(ecode.BusinessCode); ok {
					bc = b
				} else {
					// 其他 Code 类型（gcode.Code 接口），用反射拿 Code/Message
					bc = ecode.BusinessCode{
						CodeValue:   c.Code(),
						CodeMessage: "BUSINESS_ERROR",
						CodeDetail:  c.Message(),
					}
				}
			}
		} else {
			bc = ecode.InternalError
		}

		// 日志统一在 response.Error 内落（带 cause 即打印），此处不重复
		response.Error(r, bc, err)
	}
}

var _ gcode.Code = ecode.Success
