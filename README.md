# Đi Chùa Online

Trải nghiệm chánh điện 2.5D trên web, kèm máy chủ điều khiển phiên TikTok LIVE và overlay OBS thời gian thực.

## Tính năng

- Vào chánh điện, chọn nhân vật, gõ mõ, thỉnh chuông, thắp hương và rút thẻ lời Phật dạy.
- Tích công đức và bảng xếp hạng người tham gia.
- Trang điều khiển phiên live, nhạc nền, nhịp mõ, lịch đọc kinh và giọng đọc tiếng Việt Edge TTS.
- Kết nối TikTok LIVE qua `tiktok-live-connector`.
- Overlay 9:16 cho OBS/TikTok LIVE, đồng bộ với bảng điều khiển bằng WebSocket.
- Tự động deploy trải nghiệm web tĩnh lên GitHub Pages khi push vào `main`.

## Chạy local

Yêu cầu: Node.js 20+ và npm.

```bash
npm install
npm start
```

Mở các địa chỉ sau:

| Mục đích | Địa chỉ |
| --- | --- |
| Trải nghiệm web | `http://127.0.0.1:3000/` |
| Bảng điều khiển | `http://127.0.0.1:3000/live/control.html` |
| Overlay OBS/TikTok | `http://127.0.0.1:3000/live/overlay.html` |

Dùng chế độ theo dõi thay đổi khi phát triển:

```bash
npm run dev
```

Máy chủ mặc định chỉ lắng nghe `127.0.0.1:3000`. Để dùng cổng hoặc host khác:

```bash
PORT=8080 HOST=0.0.0.0 npm start
```

Trên PowerShell:

```powershell
$env:PORT=8080; $env:HOST='0.0.0.0'; npm start
```

## TikTok LIVE và OBS

1. Chạy máy chủ local rồi mở bảng điều khiển.
2. Nhập TikTok username tại phần kết nối và kết nối phiên LIVE.
3. Mở overlay từ bảng điều khiển hoặc thêm `http://127.0.0.1:3000/live/overlay.html` làm Browser Source trong OBS.
4. Chỉ mở cổng ra mạng ngoài khi cần; bảng điều khiển có quyền phát thông báo và thay đổi trạng thái phiên.

## GitHub Pages

Workflow `.github/workflows/deploy-pages.yml` chỉ deploy giao diện tĩnh: `index.html` và `assets/`. Chức năng TikTok LIVE, TTS, WebSocket, bảng điều khiển và overlay cần Node.js server nên không hoạt động trên GitHub Pages.

## Cấu trúc

| Đường dẫn | Nội dung |
| --- | --- |
| `index.html` | Trải nghiệm chánh điện 2.5D tĩnh |
| `assets/` | Hình ảnh, hiệu ứng và nhạc nền |
| `live/server.mjs` | HTTP/WebSocket server, TTS và TikTok LIVE |
| `live/control.html` | Bảng điều khiển phiên live |
| `live/overlay.html` | Overlay 9:16 cho OBS/TikTok LIVE |
| `.github/workflows/deploy-pages.yml` | Deploy phần web tĩnh lên GitHub Pages |

## License

Repository này không kèm giấy phép phần mềm. Không được mặc định sao chép, sửa đổi hoặc phân phối mã nguồn hay tài nguyên; cần có sự cho phép của chủ sở hữu.