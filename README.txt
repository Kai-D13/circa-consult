CIRCA POS - GỢI Ý TƯ VẤN THUỐC (v1.1)
========================================

CÀI ĐẶT:
1. Giải nén file zip này ra 1 thư mục.
2. Mở Chrome, vào địa chỉ: chrome://extensions
3. Bật "Chế độ dành cho nhà phát triển" (Developer mode) ở góc trên bên phải.
4. Bấm "Tải tiện ích đã giải nén" (Load unpacked) và chọn thư mục vừa giải nén.
5. Mở trang https://pos.v2.circa.vn/ban-hang và tạo đơn hàng - khi thêm sản phẩm
   nằm trong danh sách cần tư vấn, khung gợi ý sẽ hiện ở góc dưới bên phải màn hình.

CẤU HÌNH DANH SÁCH BẰNG FILE EXCEL:
1. Bấm icon extension trên thanh công cụ Chrome, bấm "Mở trang cấu hình".
2. Chuẩn bị file Excel (.xlsx) theo mẫu "mau-tu-van.xlsx" đi kèm, gồm 4 cột:
     - Nhóm      : tên nhóm hiển thị trên khung gợi ý (VD: Nhóm Vitamin C)
     - Từ khoá   : từ khoá nhận diện sản phẩm trong đơn, nhiều từ khoá ngăn bằng dấu phẩy
     - Tên gợi ý : tên sản phẩm gợi ý tư vấn/khuyến mãi
     - Ghi chú   : (tuỳ chọn) ghi chú kèm theo
3. Mỗi DÒNG là một gợi ý. Muốn 1 nhóm có nhiều gợi ý thì tạo nhiều dòng và để trống
   cột "Nhóm"/"Từ khoá" ở các dòng sau (sẽ tự hiểu là thuộc nhóm dòng trên).
4. Chọn file, kiểm tra bảng "Xem trước", rồi bấm "Lưu danh sách".
5. Nút "Khôi phục mặc định" đưa về danh sách mẫu ban đầu.

LƯU Ý:
- Extension nhận diện sản phẩm bằng cách so khớp từ khoá (không phân biệt hoa/thường,
  không phân biệt dấu) với tên sản phẩm hiển thị trong giỏ hàng.
- Danh sách được lưu trong trình duyệt (chrome.storage), không gửi ra ngoài. Việc đọc
  file Excel diễn ra hoàn toàn trên máy (dùng thư viện SheetJS đóng gói sẵn).
- Nếu giao diện Circa POS thay đổi cấu trúc bảng, có thể cần cập nhật lại phần chọn
  phần tử (TABLE_SELECTOR) trong content.js.

TỆP TRONG THƯ MỤC:
- manifest.json .......... khai báo extension
- content.js / content.css  hiển thị khung gợi ý trên trang bán hàng
- data.js ................ danh sách mặc định
- popup.html / popup.js .. nút mở trang cấu hình
- options.html / options.js  trang cấu hình (nhập Excel)
- xlsx.full.min.js ....... thư viện đọc file Excel (SheetJS)
- mau-tu-van.xlsx ........ file Excel mẫu để điền
