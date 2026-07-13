# Chrome Web Store listing

## Thông tin chung

- Publisher: Circa Pharmacy
- Support email: hoangvudn96@gmail.com
- Visibility: Unlisted
- Category: Productivity
- Language: Vietnamese
- Privacy policy: https://circa-consult.vercel.app/privacy

## Tên

Circa POS - Gợi ý tư vấn bán kèm

## Mô tả ngắn

Công cụ hỗ trợ tư vấn sản phẩm bán kèm dành cho Circa POS.

## Mô tả chi tiết

Circa POS - Gợi ý tư vấn bán kèm hỗ trợ nhân viên nhà thuốc tư vấn sản phẩm phù hợp ngay trong màn hình bán hàng Circa.

Tiện ích nhận diện chính xác sản phẩm trong giỏ hàng bằng product ID, đối chiếu với dataset tư vấn do Admin Circa quản lý tập trung và kiểm tra giá, tồn kho thực tế tại cửa hàng trước khi hiển thị gợi ý.

Chức năng chính:

- Đồng bộ dataset tư vấn tập trung khi Chrome khởi động, khi mở trang POS và định kỳ 15 phút.
- Nhận diện sản phẩm trong giỏ hàng theo product ID.
- Hiển thị nội dung tư vấn bán kèm ngay trên màn hình POS.
- Hiển thị tổng tồn base unit, đơn vị bán mặc định và đúng giá của đơn vị đó.
- Chỉ hiển thị sản phẩm gợi ý còn tồn và có giá hợp lệ tại cửa hàng hiện tại.
- Không yêu cầu nhân viên POS tự import hoặc cấu hình dataset.

Tiện ích chỉ hoạt động trên hệ thống Circa POS và dành cho hoạt động nội bộ của Circa Pharmacy.

## Single purpose

Hỗ trợ nhân viên Circa POS tư vấn sản phẩm bán kèm còn tồn kho dựa trên sản phẩm trong giỏ hàng và dataset tư vấn được quản lý tập trung.

## Permission justifications

- `storage`: lưu dataset tư vấn và trạng thái đồng bộ cục bộ trên trình duyệt.
- `alarms`: kích hoạt đồng bộ dataset định kỳ mỗi 15 phút.
- `https://pos.v2.circa.vn/*`: nhận diện product ID trong giỏ hàng và hiển thị giao diện gợi ý trên POS.
- `https://api.v2.circa.vn/*`: kiểm tra giá và tồn kho của sản phẩm gợi ý bằng phiên POS hiện tại.
- `https://pos.dev.circa-v2.buymed.tech/*`: chạy cùng chức năng trên môi trường Circa POS DEV dành cho reviewer; đọc giỏ hàng và gọi API `/backend/v2/product` bằng phiên DEV hiện tại.
- `https://wbbjxaegcubhyxgemucj.supabase.co/*`: tải dataset tư vấn đã được Admin Circa publish.

## Test instructions cho Chrome Web Store reviewer

Credentials được nhập riêng trong hai trường Username và Password của tab Test instructions. Tài khoản test không yêu cầu 2FA.

```text
1. Sign in at https://pos.dev.circa-v2.buymed.tech using the test credentials provided above. No 2FA is required.
2. Open the Sales page and create a new order. A sample order URL has the format:
   https://pos.dev.circa-v2.buymed.tech/ban-hang/{order-id}
3. Search for product ID 1109 and add it to the order.
4. The extension reads product ID 1109 from the Circa POS cart and displays the "Gợi ý tư vấn bán kèm" panel at the bottom-right of the cart area.
5. The published consultation dataset maps source product 1109 to suggested product 1107.
6. The extension calls the Circa DEV endpoint /backend/v2/product with the current POS session, verifies stock and price, and displays product 1107 only when it is sellable at the test POS.
7. Expected test data: suggested product 1107, seller CIRCATEST, sale unit "bịch", price 222,300 VND. Stock quantity can change during testing.
8. The panel can be minimized or closed without submitting, refreshing, or changing the POS order.

The extension does not collect customer identity, payment information, diagnoses, or medical records. The POS session token is sent only to the Circa API to authenticate the stock and price request. It is never sent to Supabase.
```

## Privacy Practices

Khai báo extension xử lý:

- Authentication information: session token của POS, chỉ dùng để xác thực API tồn kho Circa.
- Website content: product ID và tên sản phẩm trong giỏ hàng POS.
- Location không được thu thập; `pos_id` là mã cửa hàng vận hành, không phải vị trí địa lý người dùng.

Xác nhận:

- Không bán dữ liệu.
- Không dùng dữ liệu cho quảng cáo hoặc chấm điểm tín dụng.
- Không dùng dữ liệu ngoài single purpose đã công bố.
- Không cho phép con người đọc dữ liệu người dùng, trừ trường hợp bảo mật/pháp lý hoặc có sự đồng ý cụ thể theo chính sách.
- Tuân thủ Limited Use requirements.
