# 聚影 JuYing

免费在线视频聚合搜索与观看平台,开箱即用的 Windows 桌面版。

遵循 [AGPL-3.0](LICENSE) 协议开源。

| ![首页](docs/screenshots/home.png) | ![搜索联想](docs/screenshots/search-suggest.png) |
| --- | --- |
| **首页 · 豆瓣热门推荐** | **搜索联想 · 输入即出片** |
| ![搜索结果](docs/screenshots/search-results.png) | |
| **聚合搜索 · 多源并行,一键换源** | |

## 特性

- **聚合搜索**:多采集站服务端并行搜索,同名影片自动合并,画质探测与一键换源
- **搜索联想**:输入即时联想豆瓣热度影片(海报/年份/剧集标签,热度高在前),回车直达聚合结果;搜索词与历史记录支持模糊匹配(搜「流地」也能带出「流浪地球」)
- **播放器**:HLS / HTTP-FLV 播放,画中画、截图、倍速、自动连播、片头片尾跳过标记
- **直播**:IPTV M3U 订阅解析,按分组浏览、频道收藏、台标与节目单
- **桌面版**:Electron 封装——内置服务随软件启动、单实例、无需命令行,支持鼠标侧键 / Alt+方向键导航、F5 刷新;服务端口跨启动固定,观看历史与设置重启不丢
- **省流模式**:预取窗口收紧到 2 分钟、暂停不再预载整集,移动流量场景大幅减少浪费,画质不变(默认开启,设置中可关)
- **隐私**:播放进度与观看历史存于本机 IndexedDB,无账号体系,服务只监听本机回环地址

## 使用

### 安装包(推荐)

从 [Releases](https://github.com/devthires/juying/releases) 下载 `聚影-安装版-*.exe` 双击安装。
默认访问密码 `123456`,可在 `%APPDATA%\聚影\config.json` 中加入 `{"password": "你的密码"}` 后重启软件修改。

### 源码运行

```bash
npm install
npm run dev                      # 开发模式 http://localhost:27182
npm run build && npm run start   # 生产模式
```

需要 Node.js 18+。

### 打包桌面版

双击 `desktop/重新打包.bat` 一键完成依赖安装、构建与 NSIS 安装包生成;或参考脚本内容手动执行。

## 配置

复制 `.env.example` 为 `.env` 后按需修改,常用项:

| 变量 | 说明 |
| --- | --- |
| `PASSWORD` | 访问密码(必填) |
| `DEFAULT_SOURCES` | 预置点播源,JSON 数组 `[{"name":"名称","url":"Apple CMS 采集站地址"}]` |
| `DEFAULT_LIVE_SOURCES` | 预置直播源(M3U 订阅) |
| `DEFAULT_RECOMMEND_SOURCE` | 首页推荐数据源,可选 `douban`(默认)/ `bangumi` / `hot-list` |

桌面版的预置源在 `desktop/main.js` 中同步维护;访问密码优先读取 `%APPDATA%\juying-desktop\config.json`。

## 免责声明

本项目不存储任何视频文件,所有内容均来自第三方公开采集站接口,仅供学习与技术研究,请勿用于商业用途。内容合法性由来源站点负责。

## License

[AGPL-3.0-or-later](LICENSE)。本项目为衍生作品,包含对原始版本的修改(2026-10)。
