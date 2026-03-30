# 手机端聊天室（快速可用版）

## 1. 项目说明

本项目已按移动端优先完成一版可用聊天室重构：
- 后端：Node.js + Express + Socket.IO + SQLite
- 前端：Vue3 + Vite（构建到 `public/app`）
- 入口：
  - 手机端新版聊天室：`/`（默认）或 `/m`
  - 旧版登录页：`/legacy`

## 2. 运行步骤

### 2.1 启动后端

可选：先在项目根目录创建 `.env` 文件（可参考 `.env.example`）：

```env
DEFAULT_ADMIN_USER=admin
DEFAULT_ADMIN_PASS=xsm@chatroom
JWT_SECRET=dev-light-chat-secret
```

```bash
npm install
npm start
```

默认地址：`http://localhost:3000`

说明：
- `DEFAULT_ADMIN_USER` / `DEFAULT_ADMIN_PASS` 用于首次自动创建管理员账号
- 若数据库中已有管理员账号，修改 `.env` 不会自动重置该账号密码

### 2.2 构建前端（新版移动端）

```bash
cd frontend
npm install --cache .npm-cache
npm run build -- --emptyOutDir
```

构建后访问：`http://localhost:3000/m`

## 3. 目录结构

```text
chatRoom/
├─ db.js
├─ server.js
├─ public/
│  ├─ index.html
│  ├─ chat.html
│  └─ app/                # Vue3 构建产物
├─ frontend/
│  ├─ src/
│  │  ├─ api/
│  │  ├─ components/
│  │  ├─ store/
│  │  ├─ styles/
│  │  └─ utils/
│  ├─ vite.config.js
│  └─ postcss.config.js
└─ docs/
   └─ api.md
```

## 4. 新接口说明（v2）

详见 `docs/api.md`，核心包含：
- 认证：注册、登录、获取与更新资料
- 房间：列表、发现、创建、加入、退出、公告更新
- 消息：分页历史、关键词搜索、已读、上传
- 实时：`message_send`、`message_receive`、`typing`、`message_read`、`presence_sync`、`message_recall`

## 5. 主题变量修改指南

主题变量在：
- `frontend/src/styles/base.css`

重点变量：
- 亮色：`:root` 下的 `--bg`、`--text`、`--primary`、`--bubble-out`
- 暗色：`[data-theme='dark']` 下同名变量

页面通过 `localStorage(chat_theme)` 记住亮暗主题选择。

## 6. 打包交付

建议在仓库根目录执行（PowerShell）：

```powershell
Compress-Archive -Path src,public,docs -DestinationPath deliver.zip
```

若目录不存在或需完整项目交付，建议：
- 包含：`public/`、`frontend/src/`、`docs/`、`server.js`、`db.js`、`package.json`
- 排除：`node_modules/`、`.env`、`frontend/.npm-cache/`
