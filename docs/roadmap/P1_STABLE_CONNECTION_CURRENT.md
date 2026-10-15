# P1 — Stable Connection (Current Implementation Plan)

**Goal / Mục tiêu:** RevitGPT kết nối ổn định với Revit và đúng model người dùng chủ động bind. P1 phục vụ người dùng gọi Job trên model đang mở; không biến kết nối thành một hệ thống quản lý/tiếp tục công việc dài hạn.

**Trạng thái:** Kế hoạch P1 thay thế Rev9 từ 15/10/2026. Nhiều tính năng kết nối đã được Human Test trước đây. **Bản code được đơn giản hóa trên branch hiện tại vẫn phải qua CI và test ảnh hưởng thực tế trước khi release**; không dùng kết quả Human Test của bản cũ để chứng nhận mã mới.

**Nguồn phạm vi:** [Product Goal & P1/P2/P3](PRODUCT_GOAL_AND_PHASE_PLAN.md). [Change Register](PLAN_SUPERSESSION_AND_CHANGE_REGISTER.md) giải thích tài liệu/gate cũ nào không còn dùng.

## Phase 1 — Xác định và giữ đúng chức năng đang có

**GOAL:** Không code lại những chức năng kết nối đã dùng được chỉ vì plan cũ phức tạp.

1. Windows startup/Tray/Slim MCP/Secure Tunnel ở trạng thái phù hợp; @rg là điểm kích hoạt workspace. Khi Revit mở và binding hợp lệ, Revit MCP khả dụng.
2. Một primary bound Revit Model cho một host đang dùng; Bind Current là hành vi chuyển model có chủ đích. Đổi tab hoặc đổi view **không tự rebind**.
3. Nhiều ChatGPT conversations cùng model; đóng/mở panel, đổi chat hoặc transport không được tước binding của nhau.
4. Chỉ Revit MCP phụ thuộc Revit có đang mở; phần chuẩn bị Job/Dynamo/Knowledge qua ChatGPT có thể hoạt động khi Revit tắt.
5. Khi tạm mất kết nối, khôi phục đúng tầng kết nối bị lỗi. Lỗi trả từ một tool không được làm rơi toàn bộ phiên kết nối khỏe mạnh. Nếu model đã đóng/crash, thao tác trên model kết thúc, không khôi phục Job dang dở.

**Giới hạn:** Độ đúng sai của từng công cụ Read/Write và nghiệp vụ Revit chuyển P2. Phần liên quan tính đúng đắn của Native Revit Write/Transaction **không bị vô hiệu hóa** bởi việc gỡ Job recovery.

## Phase 2 — Bỏ phụ thuộc không cần thiết khỏi đường chạy P1

**GOAL:** Một file journal cũ/lỗi hoặc trạng thái Stop của Job cũ không thể chặn kết nối/mở workspace mới.

- Không khởi tạo `work-journal.json` để quyết định có cho phép gọi công cụ hay không.
- Không đối chiếu SYSTEM/Native side effects của một Job sau Windows restart để cấp quyền kết nối; không chạy tác vụ cũ khi reconnect.
- Không yêu cầu `STOP_PENDING`, `STOP_BLOCKED`, `rg/stop`, accepted-work continuation và các nhánh recovery làm hợp đồng điều khiển P1.
- Giữ `STANDBY`, `WORKSPACE_AWAKE`, `FULLY_AWAKE`, ràng buộc `@rg`, binding/host identity, log kết nối và Revit arrival/exit.
- Các module journal và test cũ hiện được giữ làm lịch sử, **không được import bởi runtime P1** hoặc yêu cầu PASS để nghiệm thu P1. Chúng không mặc nhiên là tính năng của P3.
- Startup tracing PR #6 là công việc P1 riêng; kiểm tra việc khởi động lại của Windows không gắn điều kiện khôi phục work journal.

**Thực hiện trên nhánh phát triển, không áp dụng cho máy người dùng trước khi release.**

## Phase 3 — Kiểm tra đúng phạm vi

**GOAL:** Chứng minh bản sửa không làm hỏng P1 đã hoạt động, không tái tạo một chuỗi Human Test/gate thừa.

**Tự động:** Node/PowerShell syntax; thử `@rg` / awake intent; nhiều MCP sessions/transport recovery; model binding/host identity; phân loại tool và từ chối công cụ chưa đăng ký; Revit arrival/exit; lỗi tool không hạ toàn bộ MCP; không còn đường gọi journal/Stop cũ trong `src/index.mjs`. Dùng lại test hiện có khi phù hợp.

**Human Test khi bản triển khai thay đổi thực sự ảnh hưởng P1:** Kiểm tra một model mở/bind, hai chat dùng chung model, chuyển tab không rebind, đóng/mở model, một lỗi tool nhưng kết nối vẫn hoạt động, panel và sleep/wake nếu liên quan diff. Không dùng lỗi Write/annotation/parameters nghiệp vụ làm lý do P1 fail; lỗi đó đi P2. Các bài trước đã PASS mà code không đụng tới chỉ cần đối chiếu regression, không yêu cầu test lại vô ích.

**Trạng thái:** CI PASS chỉ là offline PASS. Host PASS của **code sửa** chưa được tuyên bố khi chưa test trên Revit thực. Không merge/deploy cho tới khi người dùng duyệt.

## Phạm vi và phụ thuộc các phase tiếp theo

**P2:** Tập trung bộ Revit MCP thực sự đúng; đặc biệt Write/MEP/Views/Annotation/Selection/Parameters, .dyn loader và thực thi qua Revit theo quyền đã cấp. P2 có thể chạy tool/test độc lập, không chờ Job runtime.

**P3:** Chỉ chốt **định hướng** Operator/Builder, Job, Dynamo và Knowledge ở bước này. **Không viết lại detailed implementation plan P3 trước khi có kết quả rà soát P1 và P2.** P3 là khác biệt sản phẩm, cần được định nghĩa từ workflow thực tế của user, không lấy các giả định long-running Job của P1 cũ làm đầu vào.

## Review rules

- Mọi finding phải chỉ rõ nó làm hỏng yêu cầu P1 nào ở trên, kèm mã hoặc bằng chứng.
- Đề xuất về retry/durable resume/journal/cursor/stop-drain không được thêm vào P1 nếu không có yêu cầu mới.
- Không xây thêm thủ tục để xử lý hậu quả của hàng nghìn lượt gọi MCP vì cách thực hiện mặc định là **một vài lượt MCP + xử lý dữ liệu + Dynamo**.
- Các test cũ kiểm tra chức năng đã supersede không còn là gate P1, kể cả khi còn file lịch sử.
