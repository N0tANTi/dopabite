# 共享评分与账号架构

状态：第一阶段已实施
更新：2026-09-22

## 结论

第一阶段采用同域自托管架构：

```text
浏览器 React 应用
      │  /api，同域安全 Cookie
      ▼
Node.js + Hono API + Better Auth
      │
      ▼
SQLite（WAL）
```

这台腾讯云主机是 2 核、约 2 GB 内存，已经安装 Node.js 22，但没有 Docker 或 PostgreSQL。对当前产品规模，单机 SQLite 比额外维护数据库服务更省资源，也足够支持社区评分的早期读写量。API 与静态站点使用同一域名，可以避免跨域 Cookie 和额外网关配置。

数据库文件必须放在独立于代码发布目录的持久化路径，例如 `/srv/dopabite-data/dopabite.sqlite3`，不能放进 `/srv/dopabite/releases/`。

## 身份体验

不在进入网站时强制登录，而是采用渐进式身份：

1. 所有人都可以直接浏览店铺和社区评分。
2. 用户第一次评分时自动创建匿名账号和安全会话，不需要填写邮箱。
3. 匿名评分可以立即保存；同一账号对同一家店执行更新而不是重复新增。
4. 当用户需要跨设备同步、找回账号或管理历史评分时，再提示绑定正式登录方式。
5. 第一阶段已提供 Passkey；微信扫码在开放平台资质完成后接入，邮箱验证码只作为未来兼容方案。

微信扫码最符合国内桌面网页的使用习惯，但需要微信开放平台的网站应用资质、审核、AppID/Secret 和回调域配置。开发初期可以先启用匿名账号和 Passkey；Passkey 使用系统指纹、面容或 PIN，日常登录接近一键完成。邮箱验证码保留为账号找回和兼容兜底，不作为默认入口。

Better Auth 原生支持[匿名账号及后续绑定](https://better-auth.com/docs/plugins/anonymous)、[Passkey](https://better-auth.com/docs/plugins/passkey)、[邮箱验证码](https://better-auth.com/docs/plugins/email-otp)和数据库会话，因此不需要自研密码或会话协议。

## 数据模型

### 认证表

由 Better Auth 管理 `user`、`session`、`account`、`verification` 和 `passkey`。

### 餐厅快照

`restaurants`

- `amap_poi_id`：高德 POI ID，主键
- `name`、`address`、`category`
- `longitude`、`latitude`
- `last_seen_at`

高德仍是店铺事实来源。这里只保存评分关联所需的最小快照，不复制高德完整数据集。

### 用户评分

`ratings`

- `id`
- `user_id`
- `amap_poi_id`
- `taste_score`
- `value_score`
- `return_score`
- `note`
- `status`：`published`、`pending` 或 `rejected`
- `created_at`、`updated_at`

对 `(user_id, amap_poi_id)` 建唯一约束。用户再次评分时更新原记录，社区均分只统计 `published` 数据。

## API 边界

- `GET /api/restaurants/:poiId/ratings`：公开评分摘要和分页评论
- `PUT /api/restaurants/:poiId/my-rating`：新增或更新自己的评分
- `DELETE /api/restaurants/:poiId/my-rating`：删除自己的评分
- `GET /api/me/ratings`：当前用户的评分历史
- `POST /api/ratings/import-local`：登录后一次性导入原有 `localStorage` 评分
- `/api/auth/*`：Better Auth 身份与会话接口

所有聚合分数在服务端计算，前端不能提交社区均分。写接口必须校验分数范围、文字长度、会话归属和请求来源。

## 防刷与隐私

- 使用 `HttpOnly`、`Secure`、`SameSite=Lax` Cookie，不把会话令牌放进 `localStorage`。
- 每个账号每家店只有一条评分，并对匿名注册、评分写入和验证码发送分别限流。
- 匿名账号仍需记录服务端用户 ID；清除 Cookie 后重复注册无法完全避免，因此异常高频评分进入 `pending`。
- 第一阶段使用固定窗口限流并立即发布评分；自定义昵称和审核队列留给后续管理端。
- 公开接口只返回昵称和评价，不返回邮箱、登录方式或内部用户 ID。
- 提供删除本人评分和注销账号的能力；管理操作保留审计记录。

## 存储与备份

- SQLite 启用 WAL、外键和 busy timeout。
- 使用 SQLite 官方备份机制创建一致性快照，不直接复制正在写入的数据库文件。
- 本机保留 7 个每日快照，并同步至少 30 天到腾讯云 COS 等独立存储。
- 每次数据库迁移前创建并校验备份；代码发布不得覆盖 `/srv/dopabite-data/`。

SQLite 的 [WAL 模式](https://sqlite.org/wal.html)允许读取和写入更好地并行；[Backup API](https://sqlite.org/backup.html)可在应用运行时生成一致性快照。

## 何时迁移 PostgreSQL

出现以下任一情况再迁移：

- 需要同时运行两个以上 API 实例
- 持续写并发开始造成明显锁等待
- 需要复杂审核后台、分析查询或独立数据团队
- 需要数据库级高可用和托管时间点恢复

API 使用稳定的 UUID、迁移脚本和仓储层隔离 SQL，避免把 SQLite 特有语法扩散到业务代码，后续可以平滑迁移到 PostgreSQL。

## 实施顺序

1. 新增 `apps/api`、数据库迁移和健康检查。
2. 接入匿名会话、Passkey 与单店评分 Upsert。
3. 将社区均分和评论读取切换到 API。
4. 提供本地评分一次性导入。
5. 配置限流、审核状态、每日备份和 COS 异地副本。
6. 申请并接入微信开放平台扫码登录，邮箱验证码作为备用。
