package controller

import (
	"github.com/gogf/gf/v2/errors/gerror"

	"github.com/life-assistant/api/internal/consts/ecode"
)

// gerrorCodeOf 从 gerror 中提取 BusinessCode
// service 层通过 gerror.NewCode(ecode.AuthXxx) 抛出，这里反向解包
func gerrorCodeOf(err error) *ecode.BusinessCode {
	if err == nil {
		return nil
	}
	// 检查是否是 gerror 且带有 code
	if gerr, ok := err.(*gerror.Error); ok && gerr.Code() != nil {
		if bc, ok := gerr.Code().(ecode.BusinessCode); ok {
			return &bc
		}
	}
	return nil
}
