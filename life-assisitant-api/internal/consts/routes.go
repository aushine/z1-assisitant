// 路由前缀全局常量（D-03 第十三轮）
//
// 背景：nginx 同机代理多服务时 /api、/uploads 极易撞名，故整个 Z1 后端
// （业务 API + 上传静态直出）统一收敛在 /z1 服务前缀之下：
//
//	/z1/api/v1/*   业务路由（router.go 单组挂载）
//	/z1/uploads/*  头像等上传文件静态直出（main.go AddStaticPath）
//
// 换前缀只改本文件 ServicePrefix 一行，路由组、JWT 白名单、限流、静态映射、
// 头像 URL 生成/校验/换算全部引用此处常量，一处改全局生效。
// GoFrame v2 无 server 级全局前缀配置，此为框架下的正确收敛位。
package consts

const ServicePrefix = "/z1"

// APIPrefix 业务路由前缀（RegisterRoutes 的 Group 即此值）
const APIPrefix = ServicePrefix + "/api/v1"

// UploadsPrefix 上传文件静态映射前缀（users.avatar 存的 URL 以此开头）
const UploadsPrefix = ServicePrefix + "/uploads"

// LegacyUploadsPrefix 第八、九轮历史 URL 前缀（路由已不存在，仅做旧值兼容：
// validAvatar 放行、AvatarURLToPath 可清理旧文件、JWT 白名单放行）
const LegacyUploadsPrefix = "/uploads"
