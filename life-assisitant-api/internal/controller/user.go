package controller

import (
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"
	"github.com/gogf/gf/v2/util/guid"

	"github.com/life-assistant/api/internal/consts"
	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/response"
	"github.com/life-assistant/api/internal/service"
	"github.com/life-assistant/api/internal/utility"
)

// UserController 用户管理
type UserController struct{}

var User = &UserController{}

// List GET /api/v1/users
func (c *UserController) List(r *ghttp.Request) {
	var req dto.ListUsersReq
	_ = r.Parse(&req)
	items, total, err := service.User().ListUsers(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	page := req.Page
	if page <= 0 {
		page = 1
	}
	pageSize := req.PageSize
	if pageSize <= 0 {
		pageSize = 20
	}
	response.Page(r, items, total, page, pageSize)
}

// Get GET /api/v1/users/:id
func (c *UserController) Get(r *ghttp.Request) {
	id := r.Get("id").String()
	u, err := service.User().GetUser(r.Context(), id)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, u)
}

// Create POST /api/v1/users
// 返回 user + 初始密码（仅此一次，data 中含 initial_password）
func (c *UserController) Create(r *ghttp.Request) {
	var req dto.CreateUserReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	uid := r.GetCtxVar("user_id").String()
	u, initialPwd, err := service.User().CreateUser(r.Context(), uid, &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Created(r, map[string]any{
		"user":             u,
		"initial_password": initialPwd,
	})
}

// Update PATCH /api/v1/users/:id
func (c *UserController) Update(r *ghttp.Request) {
	id := r.Get("id").String()
	var req dto.UpdateUserReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	uid := r.GetCtxVar("user_id").String()
	u, err := service.User().UpdateUser(r.Context(), uid, id, &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, u)
}

// UpdateMe PATCH /api/v1/users/me（任何已登录用户，非管理员可用）
func (c *UserController) UpdateMe(r *ghttp.Request) {
	uid := r.GetCtxVar("user_id").String()
	if uid == "" {
		response.Error(r, ecode.AuthTokenMissing)
		return
	}
	var req dto.UpdateMeReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	u, err := service.User().UpdateMe(r.Context(), uid, &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, u)
}

// UploadAvatar POST /z1/api/v1/users/me/avatar（D-03 第八轮：multipart field=file）
// 落盘 <storage.upload_dir>/avatars/<uid>_<guid>.<ext>，DB 只存 /z1/uploads/avatars/<name>
// 短 URL（varchar(500) 绰绰有余）；成功后删除受管旧文件。Windows/Linux 由 filepath 通吃。
func (c *UserController) UploadAvatar(r *ghttp.Request) {
	uid := r.GetCtxVar("user_id").String()
	if uid == "" {
		response.Error(r, ecode.AuthTokenMissing)
		return
	}
	file := r.GetUploadFile("file")
	if file == nil {
		response.Error(r, ecode.ValidationFailed, errors.New("请选择图片文件（表单字段名为 file）"))
		return
	}
	// 双重白名单：扩展名 + 声明的 Content-Type；svg 排除（可携带脚本，静态直出有 XSS 面）
	ext := strings.ToLower(path.Ext(file.Filename))
	switch ext {
	case ".jpg", ".jpeg", ".png", ".webp", ".gif":
	default:
		response.Error(r, ecode.ValidationFailed, errors.New("仅支持 jpg / png / webp / gif 图片"))
		return
	}
	if ct := strings.ToLower(file.Header.Get("Content-Type")); !strings.HasPrefix(ct, "image/") || strings.Contains(ct, "svg") {
		response.Error(r, ecode.ValidationFailed, errors.New("文件类型不是允许的图片类型"))
		return
	}
	if file.Size > 5<<20 { // server.clientMaxBodySize(10M) 之下的细粒度闸
		response.Error(r, ecode.ValidationFailed, errors.New("图片不能超过 5MB"))
		return
	}
	// 文件名服务端生成（uid+随机）：不信任原始名，天然防路径穿越/互相覆盖
	name := uid + "_" + guid.S() + ext
	savePath := filepath.Join(utility.AvatarDir(r.Context()), name)
	// ⚠️ 这里**不能**用 file.Save(savePath)：GF v2.6.4 的 UploadFile.Save(dirPath)
	// 语义是「目录」——目标不存在时它会 Mkdir(dirPath)，再以**原始文件名** join 进去
	// （gfile.Join(dirPath, Basename(f.Filename))），于是 /uploads/avatars/<name> 实际
	// 是一个同名目录、图片躺在 <name>/原文件名 里；静态直出该 URL 命中目录 → 403
	// Forbidden → 前端 <img> 恒加载失败、头像永远回落到首字。
	// 故显式流拷贝到 savePath 本身（目录已由 utility.InitStorage 保证存在）。
	if err := saveUploadFile(file, savePath); err != nil {
		response.Error(r, ecode.InternalError, errors.New("图片保存失败: "+err.Error()))
		return
	}
	url := consts.UploadsPrefix + "/" + utility.AvatarSubDir + "/" + name
	oldURL, err := service.User().SetAvatarURL(r.Context(), uid, url)
	if err != nil {
		_ = os.Remove(savePath) // 写库失败回滚，不留孤儿文件
		writeError(r, err)
		return
	}
	// 清理受管旧头像（非 /uploads/ 前缀的外链或空值自动跳过）
	if p := utility.AvatarURLToPath(r.Context(), oldURL); p != "" {
		_ = os.Remove(p)
	}
	response.Success(r, g.Map{"avatar": url})
}

// saveUploadFile 把上传文件按「服务端指定的完整文件路径」落盘。
// GF 的 UploadFile.Save(dirPath) 只接受目录且会强制使用原始文件名，
// 无法满足 <uid>_<guid>.<ext> 这种服务端命名，故自行 Open/Create/Copy。
func saveUploadFile(file *ghttp.UploadFile, dstPath string) error {
	src, err := file.Open()
	if err != nil {
		return err
	}
	defer src.Close()

	dst, err := os.Create(dstPath)
	if err != nil {
		return err
	}
	defer dst.Close()

	if _, err = io.Copy(dst, src); err != nil {
		return err
	}
	return dst.Sync()
}

// UpdateStatus PATCH /api/v1/users/:id/status
func (c *UserController) UpdateStatus(r *ghttp.Request) {
	id := r.Get("id").String()
	var req dto.UpdateUserStatusReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	uid := r.GetCtxVar("user_id").String()
	if err := service.User().UpdateStatus(r.Context(), uid, id, &req); err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, map[string]any{"message": "状态已更新"})
}

// Delete DELETE /api/v1/users/:id
func (c *UserController) Delete(r *ghttp.Request) {
	id := r.Get("id").String()
	uid := r.GetCtxVar("user_id").String()
	if err := service.User().DeleteUser(r.Context(), uid, id); err != nil {
		writeError(r, err)
		return
	}
	response.NoContent(r)
}
