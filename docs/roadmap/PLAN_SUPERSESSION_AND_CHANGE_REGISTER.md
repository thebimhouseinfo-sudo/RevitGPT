# RevitGPT — Supersession & Change Register (15/10/2026)

## GOAL
Ngăn plan cũ và các vòng review tạo thêm requirement, dependency hoặc Human/CI gate không phục vụ mục tiêu CAD/BIM Assistant. Ghi lại **chính xác thay đổi về quyền hạn của tài liệu**, không coi việc sửa plan là lệnh xóa/sửa code.

**Nguồn quyết định phạm vi mới:** [PRODUCT_GOAL_AND_PHASE_PLAN.md](PRODUCT_GOAL_AND_PHASE_PLAN.md). Các nội dung cũ xung đột với nguồn này có trạng thái **SUPERSEDED AS REQUIREMENT** ngay cả khi chúng còn tồn tại trong code hoặc test.

## Quy tắc đọc tài liệu

1. **Phạm vi sản phẩm và tiêu chí chấp nhận:** chỉ lấy từ bản ngôn ngữ tự nhiên đã duyệt.
2. **Plan triển khai kỹ thuật mới:** có thể dùng hiện trạng code/tests như dữ liệu; không tạo scope hay gate vượt tài liệu trên.
3. **Plan cũ:** chỉ làm lịch sử, bằng chứng điều tra hoặc ý tưởng chưa duyệt, không dùng để BLOCK một thay đổi độc lập.
4. **An toàn kỹ thuật thực tế:** Bind đúng model, UI-thread/Transaction Revit, không chạy lại Write mù quáng khi kết quả chưa rõ **trong phiên thực thi hiện tại** vẫn phải bảo đảm. Điều này khác với checkpoint/journal/resume Job sau crash.
5. **Không có tác động code tự động:** muốn gỡ mã/test obsolete cần điều tra ảnh hưởng cụ thể, đề xuất cách sửa nhỏ nhất và có lệnh thực hiện riêng.

## Supersession và disposition

| Nguồn cũ | Trạng thái từ 15/10 | Giữ lại | Không còn được coi là gate/yêu cầu |
|---|---|---|---|
| `P1_STABLE_RUNTIME_CONNECTION_PLAN.md` Rev9 | **SUPERSEDED AS IMPLEMENTATION PLAN** | Connect, multi-chat, bind, Sleep/Wake, real layer failure detection | P1-C/D journal, crash-reconciliation, STOP_PENDING/STOP_BLOCKED, stop fence, accepted-work continuations, synthetic reboot unresolved-work, các gates phụ thuộc A→B→C→D→F |
| `AUTHORITY_LIFECYCLE.md` Rev9 | **SUPERSEDED AS P1 ACCEPTANCE AUTHORITY** | Identity/binding, host ownership, chống mất kết nối | `rg/stop` graceful-drain làm mục tiêu, durable work admission/replay/reconciliation |
| `P1_F_CONSOLIDATED_REAL_REVIT_ACCEPTANCE.md` | **SUPERSEDED AS REQUIRED TEST LIST** | Tình huống mở/đóng model, binding/multi-chat, sleep/wake, real startup khi liên quan | H03 Write tool như gate P1, H04 `rg/stop`, H06 seeded journal |
| `DETAIL_EXECUTION_PLAN.md` (J-8A2C) | **SUPERSEDED ALL PHASE/DEPENDENCY GATES** | Kỹ thuật/hồ sơ đã làm, yêu cầu thư viện Job, Dynamo hiện còn phù hợp | Chuỗi E-PY/E1/E2/E3/E4/E4J, P3 resume, transactional recovery, yêu cầu restart/checkpoint |
| `ROADMAP.md` các dòng cũ R4/P0/P1B | **SUPERSEDED AS EXECUTION TOPOLOGY** | Năng lực MCP riêng, Jobs/Dynamo/Knowledge, panel, registry | GSA cursor/milestone làm cổng code, lease/TTL cũ, Knowledge Writer phải resume Job, A4 restart/checkpoint gate |
| `DECISION_REGISTER.md` D-01…D-38 | **HISTORICAL / RETAIN EVIDENCE** | Quyết định đã đo và các dữ kiện thực tế | Nhãn `APPROVED P1 TARGET` cũ không được áp dụng khi xung đột với scope mới |
| `P1_A_BASELINE_AND_DISPOSITION.md` | **HISTORICAL EVIDENCE** | Existing source facts, tests and verified bugs | Không tạo lại gate A/CR-13/14 trước code |
| `P1_WINDOWS_LOGON_AUTOSTART_RECOVERY_PLAN.md` | **SCOPE REDUCED / HISTORICAL DETAIL** | Windows startup, logging, owned-process isolation và human login test | Không thêm journal/resume/STOP_BLOCKED làm startup success condition |
| `RG-CG-ADDIN-PLAN.md` | **RG lifecycle parts SUPERSEDED** | Add-in tiện ích, panel UI, bound model; phần CadGPT không thay đổi | Pair/lease/rg-stop/gates cũ cho RevitGPT |
| `docs/superpowers/plans/2026-10-07-*` và `2026-10-08-*` | **HISTORICAL PLANS** | Evidence về UI/bridge/host tests | Không biến từng P2A/B/C/D/E hoặc P3A/B/C thành gate mới |
| `2026-10-10-full-bim-mcp-v1-implementation-plan.md` | **ALREADY SUPERSEDED** | Historical Revit MCP design | Không hồi sinh combined Brain+MCP+Job scope |
| `2026-10-10-revit-mcp-v1-implementation-only.md` và `...-detailed-implementation-plan.md` | **P2 TOOL REFERENCE (REVIEW SCOPE FIRST)** | Bộ MCP tool được người dùng yêu cầu, verification tools, Revit Transaction, kiểm tra theo nhóm và một đợt human test | Không lấy yêu cầu long-running operation journal/Job recovery làm P2 dependency; không lấy câu `NOT IMPLEMENTED` lịch sử để coi code hôm nay chưa có |
| `SHARED_WINDOWS_TRAY_AUTOSTART_INTEGRATION_PLAN.md` (nếu PR #6 được merge) | **SEPARATE STARTUP WORK** | Log startup/phân biệt lỗi của ba app | Không mở rộng sang sửa CadGPT hoặc GPTWorker nếu chưa có yêu cầu |

## CHANGE REQUIRED — các bước thực hiện kế tiếp khi có yêu cầu sửa code

- **Không làm lại P1 đã PASS theo chức năng:** chỉ nghiệm thu phần kết nối còn thiếu bằng evidence hiện có, và kiểm tra regression tương ứng với code sửa.
- **P2:** tiếp tục kiểm tra, sửa MCP theo đúng tool/nhóm tool. Không yêu cầu Job checkpoint hay P3 runtime đã hoàn tất.
- **P3:** xây Operator/Builder harness, Job và Dynamo thật; Job không resume qua crash. Nếu code đã có durable journal/STOP fence, đánh dấu **REVIEW FOR SIMPLIFICATION**, không xóa mù trước khi xem chức năng phụ thuộc.
- **Các test cũ:** `rg/stop`, unresolved journal, synthetic crash replay có thể vẫn có trong CI vì code hiện tại; chúng **không phải yêu cầu nghiệm thu sản phẩm mới**. Khi sửa code liên quan, phân loại giữ (an toàn thật), chỉnh, hoặc bỏ (obsolete) dựa trên tác động. Không tùy tiện phá CI của bản cũ và cũng không để CI obsolete trở thành gate mở scope.
- **Planner/CR:** nếu một finding muốn thêm chức năng/test/gate ngoài yêu cầu đã duyệt, ghi **PROPOSED / NOT APPROVED** riêng; không đưa vào implementation plan.

## Không ảnh hưởng / bằng chứng phải giữ

- Không xóa metadata hoặc lịch sử GSA, các test report đã làm hay worktree nguồn.
- Không sửa runtime, Native DLL, model RVT hoặc state người dùng bằng commit plan.
- Không tự merge/deploy các PR đang mở.
- Không dùng `SUPERSEDED` để tuyên bố những code bug đã được sửa.

**Trạng thái:** PLAN SCOPE RESET; CODE CLEANUP CHƯA ĐƯỢC PHÊ DUYỆT, HUMAN ACCEPTANCE CHỈ DỰA TRÊN CÁC TEST THỰC TẾ ĐÃ THỰC HIỆN.
