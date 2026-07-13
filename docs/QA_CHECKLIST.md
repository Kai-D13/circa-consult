# QA checklist – Circa Consult Extension v1.2.0

Ghi kết quả mỗi case: `PASS`, `FAIL`, `BLOCKED`, kèm POS, thời gian, dataset version và ảnh/video nếu lỗi.

## A. Dataset và Admin Portal

- [ ] Admin chưa xác nhận email không đăng nhập được.
- [ ] Email không nằm trong allowlist không tạo draft được.
- [ ] Admin hợp lệ đăng nhập được.
- [ ] File một sheet tự chọn sheet và validate dữ liệu.
- [ ] File nhiều sheet hiển thị đúng danh sách sheet để Admin chọn.
- [ ] Chọn sheet thiếu schema bắt buộc bị từ chối và chỉ rõ lỗi.
- [ ] Tên sheet được lưu đúng trong History và audit log.
- [ ] Thiếu từng cột bắt buộc bị từ chối và chỉ rõ dòng/cột.
- [ ] `source_product_id` chữ, âm, 0 hoặc rỗng bị từ chối.
- [ ] `suggested_product_id` chữ, âm, 0 hoặc rỗng bị từ chối.
- [ ] Source ID bằng suggested ID bị từ chối.
- [ ] Cặp source → suggested trùng bị từ chối.
- [ ] Thiếu tên/title/note bị từ chối.
- [ ] `effective_to < effective_from` bị từ chối.
- [ ] File mẫu 6 dòng validate thành công.
- [ ] Preview hiển thị đúng 6 dòng.
- [ ] Lưu draft không ảnh hưởng dataset đang published.
- [ ] Publish draft chuyển version cũ sang archived.
- [ ] Chỉ có đúng một version published.
- [ ] Rollback archived version hoạt động.
- [ ] Audit log ghi đúng create/publish/rollback và Admin email.

## B. Central sync

- [ ] Máy POS mới cài nhận dataset mà không import Excel.
- [ ] Manual sync nhận version mới ngay.
- [ ] Sync tự động khi Chrome khởi động.
- [ ] Sync định kỳ tối đa 15 phút.
- [ ] Options hiển thị version, số rule và thời gian sync đúng.
- [ ] Draft không xuất hiện trên POS.
- [ ] Dataset schema sai không ghi đè cache đang chạy.
- [ ] Ngắt mạng vẫn dùng last-known-good dataset.
- [ ] Kết nối lại mạng sync thành công.
- [ ] Rollback được POS nhận ở lần sync tiếp theo.

## C. Cart detection và exact matching

- [ ] Trang `/ban-hang` chưa tạo đơn không hiển thị popup.
- [ ] URL `/ban-hang/<order-id>` bắt được cart table.
- [ ] Parse đúng dạng `product_id - product_name`.
- [ ] Source ID có rule hiển thị loading kiểm tra tồn.
- [ ] Tên giống keyword nhưng product ID khác không match.
- [ ] Source không có rule không hiển thị popup.
- [ ] Thêm hai source có rule xử lý cả hai.
- [ ] Xóa source khỏi cart làm suggestion biến mất.
- [ ] Suggestion đã có trong cart không được gợi ý lại.
- [ ] Một suggested ID xuất hiện từ nhiều source không bị lặp.
- [ ] Chuyển đơn hàng SPA không giữ suggestion đơn cũ.
- [ ] Đóng popup không tự bật lại nếu cart không đổi.
- [ ] Thêm trigger mới sau khi đóng làm popup xuất hiện lại.
- [ ] Minimize/expand hoạt động.
- [ ] Popup không che thao tác thanh toán quan trọng.

## D. Stock-aware suggestion

- [ ] Product `13720` tại POS test trả quantity `1` và được hiển thị khi là suggestion.
- [ ] Product `2001395` trả `stock_details: []` và hiển thị trạng thái `Hết tồn tại POS này`.
- [ ] Stock ở location khác `auto_put_location` không được đánh dấu có thể bán.
- [ ] `location_type` khác `SALES` không được cộng vào tổng tồn.
- [ ] `quantity = 0` hiển thị hết tồn dù `on_hand_qty > 0`.
- [ ] Có tồn nhưng `final_price <= 0` hiển thị chưa có giá hợp lệ.
- [ ] Nhiều lot SALES được cộng `availableQuantity` đúng.
- [ ] Product `111908` hiển thị tổng tồn base unit `60`, đơn vị `hộp`, giá default-unit `189.000 đ`.
- [ ] Giá unit `viên` `6.300 đ` không bị gắn nhầm cho unit `hộp`.
- [ ] Sản phẩm chỉ có một unit nhưng `default_sale_unit=false` vẫn fallback đúng unit/giá.
- [ ] Default unit thiếu giá không lấy nhầm giá của unit khác.
- [ ] Batch nhiều suggested IDs chỉ tạo một Product API request.
- [ ] Cache tồn 60 giây giảm request lặp.
- [ ] Sau 60 giây tồn được kiểm tra lại.
- [ ] Đổi POS làm cache key thay đổi.
- [ ] `pos_config`, `entity.id`, `storesClicked` lệch nhau thì không gọi API.

## E. Auth/API failure

- [ ] Thiếu cookie `session_token` không làm hỏng POS.
- [ ] Token hết hạn/401 hiển thị cảnh báo phù hợp.
- [ ] API 401/403 dừng retry ở background và hiển thị cảnh báo phiên đăng nhập.
- [ ] API 500 không hiển thị suggestion chưa xác nhận tồn.
- [ ] API/network lỗi retry tối đa 2 lần ở background rồi hiển thị cảnh báo.
- [ ] Supabase 4xx/5xx giữ cache cũ.
- [ ] Token không xuất hiện trong `chrome.storage.local`.
- [ ] Token không xuất hiện trong console log.
- [ ] Không có secret Supabase trong package extension.

## F. Performance và compatibility

- [ ] Chrome mục tiêu load extension không có manifest error.
- [ ] Service worker không có uncaught exception.
- [ ] Content script chỉ chạy dưới `/ban-hang/*`.
- [ ] Observer theo dõi cart, không scan toàn bộ text trang.
- [ ] Thêm/xóa liên tục 10 sản phẩm không treo UI.
- [ ] Cart 20 sản phẩm phản hồi trong giới hạn chấp nhận.
- [ ] Popup scroll được trên màn hình POS thực tế.
- [ ] Popup được neo ở góc dưới-phải vùng giỏ hàng chứa `#table-order-items-offline` và tự gắn lại sau React remount.
- [ ] Popup không che hoặc thay đổi vùng nút Hủy/Thanh toán ở sidebar bên phải.
- [ ] Nút thu gọn/mở rộng và đóng popup không submit form, reload trang hoặc làm mất sản phẩm trong đơn.
- [ ] Popup chỉ hiển thị suggested product còn tồn và có giá bán hợp lệ; không render card hết tồn.
- [ ] Nếu tất cả suggested product hết tồn, popup chỉ hiển thị một thông báo không còn gợi ý tồn kho.
- [ ] Nhóm gợi ý hiển thị STT source giống cột `#` và sắp xếp theo thứ tự hiện tại trên giỏ hàng.
- [ ] Popup fallback về góc phải màn hình nếu vùng giỏ hàng chưa render.
- [ ] Khi API phản hồi chậm hơn chu kỳ quét dự phòng, popup vẫn thoát trạng thái loading và hiển thị kết quả hoặc cảnh báo timeout.
- [ ] Remove rồi add lại cùng product ID kích hoạt scan mới không chờ 60 giây.
- [ ] Lỗi tạm thời được thử lại và không biến mất im lặng.
- [ ] Tiếng Việt hiển thị đúng UTF-8.
- [ ] Trên `pos.dev.circa-v2.buymed.tech`, content script nhận diện giỏ hàng và gọi đúng `/backend/v2/product`, không gọi API production.
- [ ] DEV product `1109` hiển thị suggested product `1107` với seller `CIRCATEST`, unit `bịch` và giá `222.300 đ` khi test data còn hiệu lực.
- [ ] DEV có `auto_put_location` rỗng chỉ được fallback khi API trả đúng một SALES location; nhiều location không được tự cộng tồn.

## G. Regression POS

- [ ] Tìm sản phẩm vẫn hoạt động.
- [ ] Thêm sản phẩm vào cart vẫn hoạt động.
- [ ] Chọn đơn vị/lot-date vẫn hoạt động.
- [ ] Thay đổi số lượng vẫn hoạt động.
- [ ] Xóa sản phẩm vẫn hoạt động.
- [ ] Thanh toán tiền mặt/chuyển khoản/thẻ không bị ảnh hưởng.
- [ ] Tạo đơn mới sau thanh toán không giữ state cũ.

## H. Pilot rollout

- [ ] Pilot POS 1 trong ít nhất một ca bán hàng.
- [ ] Đối chiếu 20 source products với expected suggestions.
- [ ] Ghi nhận false positive = 0 cho exact-ID dataset.
- [ ] Đối chiếu tồn của ít nhất 10 suggestions với màn tồn kho.
- [ ] Pilot thêm 2 POS có location khác nhau.
- [ ] Xác nhận cùng dataset version trên cả 3 POS.
- [ ] Có phương án rollback extension v1.1.0 và dataset version cũ.
- [ ] Stakeholder ký xác nhận trước rollout 25 POS.
