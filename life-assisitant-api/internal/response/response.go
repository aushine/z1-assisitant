// Package response 统一响应格式
// 规范见 ../life-assisitant/md/spec/04-API规范.md §4
package response

import (
	"net/http"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"

	"github.com/life-assistant/api/internal/consts/ecode"
)

// Body 统一响应体
type Body struct {
	Code      int         `json:"code"`
	Error     string      `json:"error,omitempty"`   // 英文 error code（机器可读），仅错误时有
	Message   string      `json:"message"`           // 中文消息（用户可读）
	Data      interface{} `json:"data,omitempty"`    // 业务数据
	Details   interface{} `json:"details,omitempty"` // 详细错误（字段级）
	RequestID string      `json:"request_id,omitempty"`
}

// Success 写 200 + data
func Success(r *ghttp.Request, data interface{}) {
	r.Response.WriteJson(Body{
		Code:      ecode.Success.CodeValue,
		Message:   ecode.Success.CodeDetail,
		Data:      data,
		RequestID: getRequestID(r),
	})
}

// Created 写 201
func Created(r *ghttp.Request, data interface{}) {
	r.Response.Status = http.StatusCreated
	r.Response.WriteJson(Body{
		Code:      ecode.Success.CodeValue,
		Message:   "创建成功",
		Data:      data,
		RequestID: getRequestID(r),
	})
}

// NoContent 写 204（删除成功等）
func NoContent(r *ghttp.Request) {
	r.Response.Status = http.StatusNoContent
}

// Error 写错误响应
// 自动根据 BusinessCode 映射 HTTP 状态码
// errs 为可选的真实底层错误（DB 错误 / 校验错误等）：
//   - 非空时外显到响应体 details.cause
//   - 同时是**全项目错误日志的唯一落点**（writeError / ErrorHandler 均经此出口，避免双份日志）
func Error(r *ghttp.Request, c ecode.BusinessCode, errs ...error) {
	body := Body{
		Code:      c.CodeValue,
		Error:     c.CodeMessage,
		Message:   c.CodeDetail,
		RequestID: getRequestID(r),
	}
	for _, e := range errs {
		if e != nil {
			body.Details = map[string]string{"cause": e.Error()}
			g.Log("error").Warningf(r.Context(), "error exposed [%s %s] code=%d(%s): %v",
				r.Method, r.URL.Path, c.CodeValue, c.CodeMessage, e)
			break
		}
	}
	r.Response.WriteJson(body)
}

// ErrorWithDetails 写带 details 的错误
func ErrorWithDetails(r *ghttp.Request, c ecode.BusinessCode, details interface{}) {
	r.Response.WriteJson(Body{
		Code:      c.CodeValue,
		Error:     c.CodeMessage,
		Message:   c.CodeDetail,
		Details:   details,
		RequestID: getRequestID(r),
	})
}

// PageBody 分页响应
type PageBody struct {
	Items    interface{} `json:"items"`
	Total    int64       `json:"total"`
	Page     int         `json:"page"`
	PageSize int         `json:"page_size"`
	HasMore  bool        `json:"has_more"`
}

// Page 写分页数据
func Page(r *ghttp.Request, items interface{}, total int64, page, pageSize int) {
	hasMore := int64(page*pageSize) < total
	r.Response.WriteJson(Body{
		Code:    ecode.Success.CodeValue,
		Message: ecode.Success.CodeDetail,
		Data: PageBody{
			Items:    items,
			Total:    total,
			Page:     page,
			PageSize: pageSize,
			HasMore:  hasMore,
		},
		RequestID: getRequestID(r),
	})
}

func getRequestID(r *ghttp.Request) string {
	if v := r.GetCtxVar("request_id"); v != nil {
		return v.String()
	}
	return ""
}
