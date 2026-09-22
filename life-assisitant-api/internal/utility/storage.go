// Package utility —— 文件存储（D-03 第八轮：用户上传文件落盘，Windows/Linux 通吃）
//
// 配置：storage.upload_dir（manifest/config/config.yaml，env 覆盖 GF_STORAGE_UPLOAD_DIR）
//   - Windows 示例："D:/z1-data/uploads"（正斜杠即可用，免反斜杠转义）
//   - Linux 示例："/data/z1/uploads"
//   - 默认 "./data/uploads"（相对启动工作目录）
//
// 对外 URL 前缀固定 consts.UploadsPrefix（/z1/uploads，第十三轮收敛），由 main.go AddStaticPath 映射到本目录；
// users.avatar 列只存短 URL（varchar(500) 绰绰有余），图片字节永远不进数据库。
package utility

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"github.com/gogf/gf/v2/frame/g"

	"github.com/life-assistant/api/internal/consts"
)

// AvatarSubDir avatars 子目录名（URL /uploads/avatars/<file> 与磁盘同构）
const AvatarSubDir = "avatars"

// UploadRoot 上传根目录（配置缺省 ./data/uploads）
func UploadRoot(ctx context.Context) string {
	s := g.Cfg().MustGet(ctx, "storage.upload_dir", "./data/uploads").String()
	if s == "" {
		s = "./data/uploads"
	}
	return s
}

// AvatarDir 头像存储目录 <upload_root>/avatars
func AvatarDir(ctx context.Context) string {
	return filepath.Join(UploadRoot(ctx), AvatarSubDir)
}

// PublicBaseURL 上传文件对外访问基址（可选配置 storage.public_url）。
// 典型值："http://192.168.101.75"（内网直连 Pi nginx）或 "https://voz21.cn"（公网）。
// 留空 = 前端回落「当前连接的后端」（同源 /z1/uploads 静态映射）。
// 归一化：去尾斜杠；没写协议头默认补 http://（配置写 "192.168.101.75" 也能用）。
func PublicBaseURL(ctx context.Context) string {
	s := g.Cfg().MustGet(ctx, "storage.public_url", "").String()
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if !strings.Contains(s, "://") {
		s = "http://" + s
	}
	return strings.TrimRight(s, "/")
}

// InitStorage 启动时建好目录（幂等，MkdirAll）
func InitStorage(ctx context.Context) error {
	return os.MkdirAll(AvatarDir(ctx), 0o755)
}

// AvatarURLToPath 把受管 URL 换算为本地路径。
// 受管前缀：/z1/uploads/（第十三轮起）、/uploads/（第八、九轮历史值，兼容清理）。
// 非受管前缀（http 外链、data:、空）返回 ""——调用方据此跳过删除。
// 含 ../ 逃逸的路径同样返回 ""（防目录穿越删除任意文件）。
func AvatarURLToPath(ctx context.Context, urlStr string) string {
	prefix := consts.UploadsPrefix + "/"
	if !strings.HasPrefix(urlStr, prefix) {
		if strings.HasPrefix(urlStr, consts.LegacyUploadsPrefix+"/") {
			prefix = consts.LegacyUploadsPrefix + "/" // 历史 URL 兼容
		} else {
			return ""
		}
	}
	rel := filepath.FromSlash(strings.TrimPrefix(urlStr, prefix))
	clean := filepath.Clean(rel)
	if clean == "." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || clean == ".." {
		return ""
	}
	return filepath.Join(UploadRoot(ctx), clean)
}
