# DopaBite

一个用高德地图发现附近餐厅、查看真实店铺信息并分享个人评分的桌面网页应用。

**在线体验：<https://food.archein.site/>**

## 功能

- 获取当前位置，也可以输入地址、地图选点或切换收藏地点
- 展示附近餐厅、真实店铺图片、高德参考分和人均消费
- 地图与店铺列表联动，支持分类、搜索、数量调整和排序
- 用口味、性价比、再来意愿组成独立的 DopaBite 评分，并展示公开昵称和评价详情
- 首次评分免注册，评分会同步到社区；收藏地点只在本人账号中同步
- 邮箱验证码无密码登录（配置 SMTP 后启用），Passkey 作为支持设备上的可选快捷方式
- 桌面优先的多巴胺视觉，兼容窄屏和减少动态效果设置

## 技术栈

- React 19、TypeScript、Vite
- 高德地图 Web JS API 2.0
- Motion、Radix UI、Phosphor Icons
- Hono、Better Auth、SQLite WAL
- Nginx，部署于腾讯云

## 本地运行

```bash
git clone https://github.com/N0tANTi/dopabite.git
cd dopabite
npm install
cp .env.example .env.local
npm run dev
```

另开一个终端启动本地 API：

```bash
npm run dev:api
```

在 `.env.local` 中填写高德 Web JS API Key 和安全密钥：

```text
VITE_AMAP_KEY=
VITE_AMAP_SECURITY_CODE=
```

没有配置高德凭据时，页面会使用内置的静安寺真实 POI 示例和明确标注的演示地图。

本地 API 默认使用 `http://localhost:5173` 和 `.data/dopabite.sqlite3`。生产环境变量示例见 [`deploy/api.env.example`](deploy/api.env.example)，其中 `BETTER_AUTH_SECRET` 必须使用随机密钥。推荐配置腾讯云 SES API 的 `TENCENTCLOUD_*` 与 `TENCENT_SES_*`；也可以使用 `SMTP_*` 回退。只有完整配置可用的邮件发送器后，界面才会开放邮箱验证码登录。

## 检查

```bash
npm run lint
npm run build
```

## 数据边界

- 高德：店铺名称、地址、坐标、分类、图片、人均消费和外部参考分
- DopaBite：用户填写的口味、性价比、再来意愿和文字评价
- 社区评分公开；收藏地点只对所属账号可见，不保存实时位置轨迹
- 公开评价只展示昵称，不公开邮箱、登录方式或内部用户标识
- 地图和服务端密钥只放在本地或服务器环境文件，不要提交到 Git

## 参考

- [poi-marker](https://github.com/Jichao-Yang/poi-marker)：高德地图与 POI 接入方式
- [Tastemap](https://github.com/Rocabor/restaurant-ranking-app)：地图、账号与社区评分产品结构
