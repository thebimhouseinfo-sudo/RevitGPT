# RevitGPT — Mục tiêu sản phẩm và kế hoạch P1/P2/P3

**Trạng thái:** BẢN KẾ HOẠCH NGÔN NGỮ TỰ NHIÊN — phạm vi do người dùng xác định ngày 15/10/2026. Đây là nguồn tham chiếu về **mục tiêu và phạm vi** cho các plan kỹ thuật sau. Không phải xác nhận rằng mọi chức năng/code đã PASS.

**Thứ tự triển khai:** sửa/kiểm chứng P1 trước → rà soát và sửa P2 MCP → **chỉ sau đó mới lập detailed implementation plan P3**. P3 ở tài liệu này chỉ ghi định hướng sản phẩm. P1 cụ thể xem [P1 Stable Connection Current](P1_STABLE_CONNECTION_CURRENT.md).

## Mục tiêu của RevitGPT

RevitGPT là **CAD/BIM Assistant** giúp người dùng thực hiện nhanh và đúng công việc trên Revit Model đang mở. Người dùng giao việc, ứng dụng hỗ trợ thực hiện và trả kết quả hoặc lỗi. **Không** thiết kế RevitGPT thành hệ thống tự động chạy tác vụ dài hạn.

**Cách sử dụng thực tế:**
1. **Chỉ có ChatGPT:** chuẩn bị, xây dựng và chỉnh sửa workflow, Job, Dynamo và Knowledge. Đây là khả năng hỗ trợ, không phải đích sử dụng chính; khi thư viện đã đủ, người dùng ít cần giai đoạn này.
2. **ChatGPT + Revit:** người dùng mở Revit Model, kết nối/bind chủ động, gọi Job đã chuẩn bị và nhận kết quả trực tiếp trên model. Đây là đích sử dụng chính.
3. **Vòng đời công việc trên model:** bắt đầu khi model được mở và chọn làm môi trường làm việc; kết thúc khi model đóng hoặc Revit crash. Trong một lần mở model, người dùng có thể gọi nhiều Job độc lập, tuần tự.
4. **Một lần chạy Job:** thường có một vài lượt MCP lấy thông tin/cập nhật, xử lý dữ liệu và nạp/chạy Dynamo khi phù hợp. Không thiết kế theo cách dùng hàng trăm/hàng nghìn tool calls để vẽ từng phần tử.
5. **Khi có lỗi:** ứng dụng trả lỗi đúng. Nếu lỗi thuộc RevitGPT/MCP thì sửa thành phần lỗi; nếu Revit/model crash thì phiên làm việc đó kết thúc. Khi model mở lại, đó là một phiên làm việc mới. **Không tự resume/replay Job sau crash.**

**Giới hạn trách nhiệm:** RevitGPT có thể duy trì Tray, kết nối, hoặc workspace chuẩn bị khi Revit không mở; điều này **không** kéo dài vòng đời của Job hay ngữ cảnh model đã đóng. Binding có chủ đích, không đổi model chỉ vì người dùng chuyển tab.

## P1 — Kết nối ổn định

**Mục tiêu P1:** ChatGPT liên lạc ổn định với đúng Revit Model mà người dùng đã chọn, kể cả khi có nhiều chat, thay view/tab, đóng/mở panel, idle, sleep/wake hoặc tạm mất kết nối.

**Công việc thuộc P1:** Windows Tray và startup; kết nối/Revit bridge; nhận biết Revit mở/đóng; một primary bound model; Bind Current khi người dùng chủ động; tránh thao tác nhầm model; nhiều chat dùng cùng model; khôi phục **kết nối** khi các thành phần kết nối thực sự lỗi, không làm hỏng phần đang khỏe; log đủ để xác định lỗi kết nối/khởi động.

**Không thuộc P1:** chứng nhận mọi Revit MCP read/write tool chạy đúng; Dynamo/Job nghiệp vụ; theo dõi tiến trình tác vụ qua Windows reboot; STOP_PENDING/STOP_BLOCKED; journal/reconciliation để khôi phục tác vụ; resume Job; mô hình hóa chuỗi tool calls kéo dài.

**Trạng thái:** Các kiểm tra thực tế về kết nối/binding/panel/multi-chat/sleep-wake đã xác nhận phần chính P1 hoạt động. Có thể xem **P1 CORE CONNECTION đạt mục tiêu sử dụng**, nhưng không đồng nghĩa mọi bài test lịch sử, mọi MCP tool hoặc startup diagnostics chưa triển khai đều PASS. Việc hoàn thiện log Windows startup đang là việc riêng, không mở lại toàn bộ P1.

**Cách kiểm tra P1:** RevitGPT tự khởi động đúng; kết nối đúng model; đa chat không giành binding; chuyển tab không tự rebind; đóng/reopen model cập nhật ngữ cảnh đúng; sleep/wake và lỗi kết nối thông thường không buộc người dùng thiết lập lại khi các thành phần có thể phục hồi. Chỉ kiểm tra phần bị sửa hoặc chưa chứng minh, không lặp toàn bộ Human Test đã PASS.

## P2 — Revit MCP thực sự dùng được

**Mục tiêu P2:** Bộ Revit MCP cung cấp các công cụ đọc, chỉnh sửa và tương tác với Revit chính xác để phục vụ các công việc thực tế.

**Phạm vi:** reads/aggregates; levels, views, elements, selection, parameters; MEP; annotation/tag/dimension; sheets/schedules; tạo/sửa đối tượng theo khả năng đã duyệt; tải tệp Dynamo và hỗ trợ việc chạy Dynamo khi được cho phép. Một số công cụ advance cũng nằm trong bộ công cụ mục tiêu. Revit MCP là thành phần kỹ thuật **riêng**, không phải bộ não hay Job runtime.

**Cách triển khai:** hoàn thiện bộ công cụ đã chốt, kiểm tra offline theo nhóm và sửa lỗi trong nhóm; tập hợp thành **một đợt Human Test thực tế** khi cần, thay vì yêu cầu người dùng test sau mỗi tool. Không bắt tất cả Revit MCP phải hoàn thiện mới được phát triển những phần P3 độc lập. Tính đúng đắn của Write, Revit Transaction, model binding và việc không ghi sai model vẫn là trách nhiệm thật của MCP, không phải hệ thống Job resume.

**Không thuộc P2:** tự xây các Job dài hạn, checkpoint/recovery cấp ứng dụng hoặc dùng tool calls hàng loạt thay Dynamo chỉ để có thêm khả năng resume.

## P3 — Job, Dynamo Writer và Knowledge

**Mục tiêu P3:** Người dùng giao việc bằng Job đã lưu; RevitGPT thực thi workflow hiệu quả trên model đang mở. Có khả năng xây dựng/thay đổi Job và Dynamo khi người dùng cần.

- **Operator harness:** thực thi **Saved Job** theo các bước đã được duyệt, reasoning thấp, chỉ suy luận trong bước được phép; runtime chuyển bước theo workflow và kết quả; không tự thêm bước.
- **Builder harness:** tạo/sửa Custom Job, viết/chỉnh sửa .dyn, sửa công cụ hoặc Knowledge khi được giao; Temp/Disposal Job thuộc Builder. Có thể đề xuất bước bổ sung, nhưng **không tự đưa vào contract** trước khi người dùng duyệt.
- **Job:** có bước và điều kiện chuyển bước trong lần chạy hiện tại; nếu một Job cần dữ liệu thô/kết quả hoặc checkpoint nội bộ, Job đó tự xác định. Không mặc định mọi Job có resume, không xây cơ chế resume/replay sau Revit crash ở cấp app.
- **Dynamo:** ưu tiên lập dữ liệu và dùng Dynamo để thực thi thao tác hàng loạt trên Revit, tránh lặp nhiều lượt MCP khi một script là đủ. Dynamo Writer là khả năng viết/chỉnh sửa đồ thị thực sự, khác với công cụ load/run.
- **Knowledge:** Knowledge lập trình Dynamo cần có quy tắc thiết yếu và tài liệu nguồn đáng tin để viết đúng trước khi đánh giá Dynamo Writer hoàn thiện; Knowledge nghiệp vụ Revit/HVAC tiếp tục phát triển qua công việc thực tế. Không tự bịa API/nodes.
- **Quản lý thư viện:** giữ Custom Job/.dyn và bản nháp có thể dùng lại, không sửa nhầm bản chính; đó là quản lý tài liệu/công cụ, **không phải** hệ thống khôi phục công việc đang chạy sau crash.

**Cách kiểm tra P3:** Operator chạy đúng một Job đã lưu trên model đang bind, dữ liệu xử lý đúng, Dynamo thực thi khi cần và trả kết quả/lỗi. Builder tạo được Job và .dyn phù hợp yêu cầu; người dùng duyệt nội dung trước khi promote. Không có bài nghiệm thu resume Job sau crash.

## Cách viết plan và review từ nay

**A. Luôn bắt đầu bằng bản ngôn ngữ tự nhiên** gồm Mục tiêu, Việc cần làm, Việc không làm, Kết quả người dùng thấy và Cách kiểm tra. Người dùng duyệt bản này **trước** khi Planner tạo bản triển khai kỹ thuật. Ghi Goal đầu file và từng phase.

**B. Bản đã duyệt là giới hạn phạm vi.** Technical Plan không được tự mở rộng mục tiêu, tạo tác vụ mới hoặc điều kiện nghiệm thu mới. Mỗi task/test phải chỉ được yêu cầu/tiêu chí nào của bản tự nhiên mà nó phục vụ.

**C. Planner/CR review đúng nhiệm vụ:** chỉ tìm sai sót ảnh hưởng kết quả đã duyệt, cách triển khai không đúng, hoặc thiếu sót kỹ thuật thực sự chặn việc thực hiện. Finding nằm ngoài phạm vi được ghi **PROPOSED / NOT APPROVED**, không được thêm vào scope, dependency hay gate. Review không được tăng độ phức tạp chỉ để xử lý rủi ro của một kiểu sử dụng mà sản phẩm không áp dụng.

**D. Không tạo gate giả.** Kiểm tra phần code thay đổi bằng test phù hợp và bằng Revit thực khi cần. Không yêu cầu hoàn thành journal/recovery/stop-drain, lịch sử GSA cursor, toàn bộ MCP V1 hay tất cả Human Test quá khứ để thực hiện một thay đổi độc lập. Không biến trạng thái tài liệu kế hoạch cũ thành bằng chứng chức năng hiện tại bị BLOCKED. Các kiểm tra bảo đảm thao tác Revit đúng model, đúng Transaction, hoặc tránh ghi trùng trong **một lần thao tác** vẫn là yêu cầu kỹ thuật hợp lệ khi có Write tương ứng.

**E. Chỉ thực thi thay đổi source/code, merge hoặc deploy khi người dùng cho phép.** Review có thể đề xuất, nhưng không tự chốt yêu cầu mới. Một yêu cầu phát triển đã được chốt không cần hỏi lại ở mỗi bước kỹ thuật nhỏ.

## Quan hệ với tài liệu cũ

Xem [PLAN_SUPERSESSION_AND_CHANGE_REGISTER.md](PLAN_SUPERSESSION_AND_CHANGE_REGISTER.md) để biết plan nào đã **SUPERSEDED**, phần nào giữ làm evidence và phần nào chỉ được xem là đề xuất. Mọi gate/phase cũ xung đột với tài liệu này **không còn là điều kiện triển khai**. Không tự động xóa code hay các bài test cũ chỉ vì kế hoạch thay đổi.
