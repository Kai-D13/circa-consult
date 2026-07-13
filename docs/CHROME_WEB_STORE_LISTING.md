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
- Cảnh báo rõ khi sản phẩm gợi ý hết tồn hoặc chưa có giá hợp lệ tại cửa hàng hiện tại.
- Không yêu cầu nhân viên POS tự import hoặc cấu hình dataset.

Tiện ích chỉ hoạt động trên hệ thống Circa POS và dành cho hoạt động nội bộ của Circa Pharmacy.

## Single purpose

Hỗ trợ nhân viên Circa POS tư vấn sản phẩm bán kèm còn tồn kho dựa trên sản phẩm trong giỏ hàng và dataset tư vấn được quản lý tập trung.

## Permission justifications

- `storage`: lưu dataset tư vấn và trạng thái đồng bộ cục bộ trên trình duyệt.
- `alarms`: kích hoạt đồng bộ dataset định kỳ mỗi 15 phút.
- `https://pos.v2.circa.vn/*`: nhận diện product ID trong giỏ hàng và hiển thị giao diện gợi ý trên POS.
- `https://api.v2.circa.vn/*`: kiểm tra giá và tồn kho của sản phẩm gợi ý bằng phiên POS hiện tại.
- `https://wbbjxaegcubhyxgemucj.supabase.co/*`: tải dataset tư vấn đã được Admin Circa publish.

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
