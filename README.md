# IP 归属地查询 · IP 归属地查询

一个简洁易用的纯前端 IP 地址归属地查询应用。属于 [IP 归属地查询](https://github.com/yqh-core) 的一员。

## 功能特点

- **多数据源自动降级**：依次尝试 ipapi.co → ipwho.is → ipinfo.io，任一可用即返回，界面上会显示本次实际生效的数据源
- **快速查询**：输入 IP 地址即可查询详细归属地信息
- **自动定位**：页面加载时自动查询并显示当前 IP 地址信息
- **详细信息**：显示国家、省份、城市、邮编、ASN、运营商、组织、经纬度、时区
- **ASN 与组织分离**：修正旧版把 AS 号当成组织名显示的问题
- **地图定位**：支持在 OpenStreetMap 和 Google Maps 上查看地理位置
- **IP类型识别**：自动识别公网 IP 和内网 IP
- **响应式设计**：完美适配 PC 端和移动端
- **免费无限制**：使用免费 API，无需注册和申请密钥

## 使用说明

### 第一步：启动应用

> ⚠️ 需要通过 HTTP 服务访问，直接双击打开 `index.html` 不行。
> 前端按 ES Module 拆成了 `js/ip-sources.js`（数据源适配）与 `js/app.js`（界面），
> 浏览器对 `file://` 协议下的模块加载有 CORS 限制，会直接报错。

```bash
# 如果安装了 Python 3
python -m http.server 8000

# 如果安装了 Node.js
npx http-server
```

然后在浏览器访问 `http://localhost:8000`

### 第二步：查询IP地址

1. **自动查询当前IP**：
   - 打开页面后会自动查询您当前的IP地址
   - 显示您的公网IP及其归属地信息

2. **手动输入IP查询**：
   - 在输入框输入要查询的IP地址（如：8.8.8.8）
   - 点击"查询"按钮或按回车键
   - 支持任意IPv4格式的IP地址

3. **快速查询我的IP**：
   - 点击"查询我的IP"按钮
   - 一键快速查询当前公网IP信息

## 功能说明

### 显示的信息

查询结果包含以下详细信息：

- **IP地址**：显示查询的IP地址
- **IP类型**：标识为公网IP或内网IP
- **国家/地区**：IP所在的国家或地区
- **省份/州**：IP所在的省份或州
- **城市**：IP所在的城市
- **邮编**：所在地区的邮政编码
- **运营商**：Internet服务提供商（ISP）
- **ASN**：自治系统号（如 AS15169）
- **运营商**：Internet 服务提供商（ISP）
- **组织**：IP 所属的组织名（不再显示为 AS 号）
- **经纬度**：地理坐标位置
- **时区**：所在地的时区信息
- **地图链接**：Google Maps和OpenStreetMap查看链接

### IP类型识别

应用会自动识别IP类型：

- **公网IP**：可以在互联网上访问的IP地址
- **内网IP**：私有网络IP地址，包括：
  - 10.0.0.0 - 10.255.255.255
  - 172.16.0.0 - 172.31.255.255
  - 192.168.0.0 - 192.168.255.255
  - 127.0.0.0 - 127.255.255.255（回环地址）
  - 169.254.0.0 - 169.254.255.255（链路本地）

## 技术栈

- **HTML5**：页面结构
- **CSS3**：响应式布局与加载动画
- **JavaScript (ES Module)**：`js/ip-sources.js` 数据源适配 + `js/app.js` 界面渲染
- **Fetch API + AbortSignal**：请求超时与并发竞态控制

## 文件结构

```
ip_location/
├── index.html          # 主页面
├── about.html          # 关于
├── privacy.html        # 隐私政策
├── 404.html            # 404
├── css/
│   └── style.css       # 样式
├── js/
│   ├── ip-sources.js   # 数据源适配层：URL 拼装 + 字段归一化 + 多源降级（无 DOM）
│   └── app.js          # 界面层：DOM 渲染与交互（不认识任何一家 API 的字段）
├── scripts/
│   └── build.mjs       # 组装 Cloudflare Pages 发布目录
└── README.md
```

## 数据源说明

依次尝试以下三个免费 IP 库，任一成功即返回，界面底部会显示本次实际生效的数据源：

| 顺序 | 数据源 | 说明 |
| --- | --- | --- |
| 1 | [ipapi.co](https://ipapi.co) | 字段最全，匿名额度约 1000 次/天 |
| 2 | [ipwho.is](https://ipwho.is) | 免密钥，有月度额度，超限返回 429 |
| 3 | [ipinfo.io](https://ipinfo.io) | 匿名额度较大，响应里会带 `missingauth` 提示 |

单个数据源超时上限 6 秒，超时即换下一个，因此最坏情况下 18 秒内必有结论。

### 为什么要有超时

实测部分网络下数据源会解析到不可达的 IPv6 地址，请求既不成功也不失败，
会一直挂到浏览器默认超时（几十秒），界面就一直转圈。加了 6 秒超时后会被快速跳过。

## 常见问题

### 1. 提示"请输入有效的 IPv4 地址"

**解决方法**：
- 检查 IP 地址格式是否正确（如：192.168.1.1）
- 确保 IP 地址的每个数字在 0-255 之间
- 不要输入域名，本工具只支持 IPv4

### 2. 提示"全部数据源均不可用"

**解决方法**：
- 检查网络连接是否正常
- 确认防火墙 / 广告拦截插件没有拦掉对上面三个域名的请求
- 三个源都免费且无需密钥，任何一个可用就能出结果

### 3. 内网 IP 无法查询详细信息

**说明**：内网 IP（如 192.168.x.x）是私有地址，各家数据源都查不到归属地，只能查询公网 IP。

### 4. 显示的位置不准确

**说明**：IP 定位基于运营商分配的 IP 段，可能与实际位置有偏差，通常精确到城市级别。


## 生产环境部署

### 使用 Nginx 部署

#### 1. 安装 Nginx

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install nginx
```

**CentOS/RHEL:**
```bash
sudo yum install nginx
```

**macOS:**
```bash
brew install nginx
```

#### 2. 配置 Nginx

创建站点配置文件：

```bash
sudo nano /etc/nginx/sites-available/ip-location
```

添加以下配置：

```nginx
server {
    listen 80;
    server_name your-domain.com;  # 替换为你的域名或IP

    root /var/www/ip-location;  # 项目文件路径
    index index.html;

    # 启用 gzip 压缩
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript;
    gzip_min_length 1000;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # 静态资源缓存
    location ~* \.(css|js|jpg|jpeg|png|gif|ico|svg)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    # 安全头部
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
}
```

#### 3. 部署项目文件

```bash
# 创建项目目录
sudo mkdir -p /var/www/ip-location

# 复制项目文件
sudo cp -r . /var/www/ip-location/

# 设置权限
sudo chown -R www-data:www-data /var/www/ip-location
sudo chmod -R 755 /var/www/ip-location
```

#### 4. 启用站点配置

```bash
# 创建符号链接
sudo ln -s /etc/nginx/sites-available/ip-location /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重启 Nginx
sudo systemctl restart nginx
```

#### 5. 配置 HTTPS（推荐）

使用 Let's Encrypt 免费 SSL 证书：

```bash
# 安装 Certbot
sudo apt install certbot python3-certbot-nginx

# 获取证书并自动配置
sudo certbot --nginx -d your-domain.com

# 自动续期测试
sudo certbot renew --dry-run
```

### 使用 Docker 部署

创建 `Dockerfile`:

```dockerfile
FROM nginx:alpine

# 复制项目文件
COPY . /usr/share/nginx/html/

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

构建并运行：

```bash
# 构建镜像
docker build -t ip-location .

# 运行容器
docker run -d -p 80:80 --name ip-location ip-location
```

## 注意事项

1. **API使用**：
   - 三个数据源均为免费匿名额度，各家限制不同（见「数据源说明」）
   - 请勿滥用，高频场景建议自行申请密钥或改用商业服务

2. **隐私保护**：
   - 本工具不存储任何查询记录
   - 所有查询通过客户端直接访问API
   - 不收集用户个人信息

3. **网络安全**：
   - IP地址是公开信息，不属于敏感数据
   - 通过IP无法获取具体的个人信息
   - 仅能查询到运营商和大致地理位置

4. **HTTPS部署**：
   - 生产环境必须使用 HTTPS，否则浏览器会因页面不安全而拦截对外请求
   - 可以使用 Let's Encrypt 免费证书，或直接部署到 Cloudflare Pages 等自带 HTTPS 的平台



## 许可证

本项目采用 MIT 许可证，可自由使用和修改。

## 相关链接

- [ipapi.co](https://ipapi.co) — 主数据源
- [ipwho.is](https://ipwho.is) — 备用数据源
- [ipinfo.io](https://ipinfo.io) — 备用数据源
- [IP 归属地查询 · 开发者工具集](https://coderkit.pages.dev)
- [IP 归属地查询 · 房贷计算器](https://repaycalc.pages.dev)

## 联系方式

如有问题或建议，欢迎通过 GitHub Issues 反馈！

---

**快速查询IP归属地，让网络世界更透明！** 🌍
