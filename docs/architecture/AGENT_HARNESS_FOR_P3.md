# Agent Harness for P3 — RevitGPT

## GOAL

Thiết kế Phase 3 với **hai execution harness độc lập cho cùng một GPT Web model** nhằm:
- **Loại bỏ over-reasoning khi chạy Saved Job:** model chỉ suy luận nghiệp vụ tại step được khai báo; không tự thêm step, check, confirmation, recovery hay workaround.
- **Loại bỏ workflow drift khi phát triển Job:** Builder viết đúng workflow user đã chốt, kể cả sau nhiều vòng review; không lén mở rộng `JOB.md`.
- **Giữ năng lực reasoning chuyên môn cần thiết** (Revit/Dynamo/HVAC), nhưng đặt giới hạn ở **phạm vi nhiệm vụ và quyền thực thi**, không ép giảm chất lượng suy luận.
- **Giảm lượt gọi GPT/MCP thừa:** Runtime xử lý các bước xác định được bằng code và tự điều phối chuyển step.
- **Giữ quyền phê duyệt workflow ở user:** Builder/Reviewer được nominate cải tiến, nhưng không được đưa vào contract khi chưa được user approve.

**Status:** HUMAN architecture direction agreed in discussion, 2026-10-13. **Design record only; NOT an implementation plan, release approval, or claim of existing capability.** No P1 scope change, no code change, no Dynamo/MCP runtime change. Phase 3 technical implementation details below remain to be verified.

## 1. Architecture and responsibilities

```text
                         USER
                          |
                    RevitGPT Router
                          |
                +---------+---------+
                |                   |
         SAVED JOB request      DEVELOPMENT / TEMP JOB
                |                   |
         OPERATOR HARNESS       BUILDER HARNESS
         strict execution       controlled development
         step-scoped reasoning  deep task-scoped reasoning
                |                   |
                +---------+---------+
                          |
                   SHARED RUNTIME
              workflow engine / state
          permissions / Job Registry / data
               Revit MCP / Dynamo runner
                          |
                     Bound Revit
```

- **One GPT Web model, two harness contracts.** Không tạo hai local agents hoặc hai workflow engines; Runtime và các dịch vụ dùng chung. Tách **execution contract thật** (context, tools, state, transitions, failure policy), không chỉ thay system prompt.
- **RevitGPT Brain** giữ vai trò suy luận chuyên môn, định tuyến và gọi capability; **Revit MCP** là subsystem riêng cung cấp thao tác Revit API; **Dynamo** là capability thực thi/authoring riêng; **Knowledge** nằm ở source theo cấu trúc Revit/Dynamo/HVAC. Không hợp nhất các thành phần này.
- **Runtime owns workflow control:** quyết định step hiện hành, điều kiện chuyển tiếp, tool permissions, postconditions và terminal state. Model không tự chỉ định step tiếp theo.
- **User owns approved workflow changes.** Yêu cầu thảo luận/lập plan không mặc nhiên cho phép sửa code hoặc contract; khi user đã phê duyệt thực hiện mới tiến hành thay đổi tương ứng.

## 2. Automatic harness routing

| User intent | Routing |
|---|---|
| Chạy/chạy lại **Saved Job** hợp lệ (Direct hoặc Reasoning) | **Operator** tự kích hoạt; user không cần gọi tên harness |
| Tạo/sửa/promote Saved Job; viết/sửa/debug `.dyn`; sửa MCP/Add-in/Runtime/Knowledge | **Builder** |
| Tạo **và chạy Temp / Disposable Job** | **Builder** từ đầu đến cuối; **không chuyển Operator** |
| Sửa Temp Job lỗi (trong phạm vi user giao) | **Builder** |
| Direct Command có tool/contract sẵn, không phải Saved Job | Có thể do Runtime/tool xử lý trực tiếp, không cần dựng Temp Job |
| Saved Job bị lỗi | Operator dừng và báo lỗi; **không tự chuyển Builder**. Chỉ khi user yêu cầu sửa mới kích hoạt Builder |

`Saved` không tự đồng nghĩa với `Verified/Executable`: Registry phải xác định phiên bản được phép chạy. Draft hoặc bản chưa đủ điều kiện không được lách qua Operator.

## 3. Operator Harness — strict Saved Job execution

**Contract:** Operator thực thi **đúng** workflow đã lưu. Reasoning **được phép và có thể rất sâu**, nhưng chỉ tại các step mà `JOB.md` giao bài toán nghiệp vụ rõ ràng.

### 3.1. Mỗi step phải đủ rõ

- **Input:** file/data/knowledge nào được cấp.
- **Task:** phải phân tích, tính toán, phân loại hoặc tạo output gì.
- **Rules:** quy tắc nghiệp vụ và cách xử lý trường hợp đã định nghĩa.
- **Output:** file/schema/định dạng và dữ liệu cần tạo.
- **Completion/postconditions:** điều kiện hoàn thành do Runtime đánh giá.
- **Failure/recovery:** kết quả lỗi và nhánh recovery **nếu đã khai báo**.

Không bắt JOB.md mô tả từng phép tính trung gian; Operator được dùng kiến thức và reasoning cần thiết để giải **đúng bài toán đã giao**, không dùng suy luận để phát minh bài toán/bước mới.

### 3.2. Operator tuyệt đối không tự

- Thêm/bỏ/đảo thứ tự step hoặc tự điều chỉnh workflow.
- Thêm check/verification, re-scan, retry, confirmation hay recovery chưa có trong contract.
- Tự chỉnh `JOB.md`, `.dyn`, script, business rules, đường dẫn hoặc tool contract để workaround.
- Gọi Revit MCP/Dynamo ngoài danh sách quyền của step.
- Tự chuyển sang Builder, tự promote hoặc tự cải tiến job.

Runtime phải **chặn quyền thực tế**, không chỉ nhắc bằng prompt. Khi step đạt postconditions, Runtime tự sang step tiếp; khi DONE thì đóng job, không phát sinh “kiểm tra thêm”.

### 3.3. Example — HVAC Airflow Distribution

Đây là **minh họa**, không phải JOB.md được phê duyệt cho một Job cụ thể:

| Step | Executor | Work | Reasoning |
|---|---|---|---|
| 1 | Runtime / Dynamo Collector | Quét FCU, airflow, grilles, systems, Element IDs và quan hệ cần thiết, xuất `collected_data.json` | Không |
| 2 | Operator | Nhóm FCU và miệng gió theo hệ thống; phân loại SA/RA; xác định số lượng; tính airflow **theo quy tắc của job**; tạo `airflow_mapping.json` cho Dynamo | Có |
| 3 | Runtime / Dynamo Writer | Nạp mapping, cập nhật hàng loạt parameter trong Revit | Không |
| 4 | Runtime | Kết thúc theo contract | Không |

Nếu job **quy định chia đều** thì FCU có Supply Airflow 600 L/s, 4 Supply Air Grilles → 150 L/s/miệng. Nếu job yêu cầu tỷ lệ khác thì thực hiện tỷ lệ đó; **không tự chọn “phân phối hợp lý”** khi thiếu quy tắc. Chỉ cập nhật đúng air type/parameter được chỉ định. Operator có thể suy luận sâu về quan hệ hệ thống và tạo mapping nhưng không tự quét lại hay thêm bước xác nhận.

**Không gọi GPT ở mọi step:** Runtime tự chạy các bước deterministic; chỉ kích hoạt Operator reasoning ở các step yêu cầu.

### 3.4. Fail-fast / No Workaround

Nếu step `Load/Run Dynamo` thất bại (ví dụ `DYN_LOAD_FAILED: airflow_mapping.json not found`):
1. Runtime dừng tại step lỗi; giữ state, input/output và diagnostics cần thiết.
2. Báo user **lỗi cụ thể do tool/Dynamo trả về**, không mặc định coi là thành công.
3. **Không tự retry, sửa path, sửa file, thay Dynamo, gọi MCP để update thủ công, quét lại hoặc thử workaround**.
4. Chỉ chạy recovery/retry nếu **đã được định nghĩa trong workflow được phê duyệt**. Nếu không, mặc định `STOP`/`FAILED` hoặc `BLOCKED` phù hợp contract.
5. User có thể yêu cầu Builder điều tra và sửa trong một nhiệm vụ **riêng**, không phải automatic escalation.

Khi yêu cầu nghiệp vụ thiếu quy tắc bắt buộc, Operator dừng/báo BLOCKED theo contract; không tự bịa quy tắc để tiếp tục.

## 4. Builder Harness — controlled development and Temp Jobs

Builder có thể sử dụng reasoning chuyên sâu để:
- Thiết kế/viết/sửa Job, Dynamo, MCP và các thành phần phát triển được user giao.
- Phân tích kỹ thuật, coding, debug, internal tests, review loop và verification.
- Tạo/chạy/sửa **Temp/Disposable Job** trong phạm vi yêu cầu; không buộc qua Operator.
- Chuẩn hóa/promote Temp Job thành Saved Job **khi user yêu cầu**. Không tự promote.

**Builder owns HOW TO IMPLEMENT, not unapproved WHAT TO EXECUTE.**

Builder **không được tự**:
- Thêm step/substep mới, thay thứ tự, đổi business rules hay điều kiện chuyển tiếp đã chốt.
- Chèn check, validation, verification, user confirmation, retry/recovery hoặc re-scan làm thay đổi workflow vận hành ngoài baseline.
- Dùng review/debug như lý do để âm thầm mở rộng `JOB.md` hoặc thực thi tác vụ Revit khác yêu cầu.
- Biến một nomination thành bắt buộc hoặc thành code/JOB contract trước user approval.

Builder **được tự kiểm tra code nội bộ** để đảm bảo implementation đúng, miễn kiểm tra đó **không bị nhét thành step/check mới khi Operator vận hành Saved Job**. Những kiểm tra kỹ thuật bắt buộc để thực thi contract và các bước nghiệp vụ ngoài baseline phải được phân biệt rõ.

Khi user giao workflow chưa đủ rõ, Builder trình bày phần thiếu/đề xuất cần quyết định; không tự viết thành quy tắc nghiệp vụ được duyệt.

## 5. Approved Workflow Baseline and drift prevention

**Observed past failure:** Sau khi user và model chốt workflow, Builder viết `JOB.md` nhưng âm thầm bổ sung step, check, confirmation/recovery; user chỉ phát hiện khi yêu cầu trình bày lại file. Đây là **implementation/workflow drift**, không phải cải tiến đã duyệt.

### Baseline is authoritative

Khi user approve workflow, đóng băng bản tham chiếu gồm:
- **Goal** (phải xuất hiện đầu tài liệu/plan).
- Step IDs/thứ tự, nhiệm vụ từng step, input/output, reasoning scope.
- Business rules, user interactions, completion/transition và failure policies.

`JOB.md` cuối phải khớp **về hành vi** với baseline, không chỉ trùng số lượng step. Phải rà cả các substeps, điều kiện ẩn và những câu “để chắc chắn” tự thêm.

### Builder self-review and Reviewer independent review

- **Implementation defect** (code/dyn/schema không làm đúng baseline) → Builder được tự sửa và tự test trong scope.
- **Workflow drift** (thừa/thiếu/đổi step hoặc thêm check/confirmation/recovery chưa duyệt) → Reviewer đánh dấu `CHANGES_REQUIRED`; Builder phải loại bỏ hoặc chờ approval, không được biện minh là “an toàn hơn”.
- **Potential improvement** → nomination riêng. Reviewer không được chuyển nomination chưa duyệt thành `CHANGES_REQUIRED` buộc thêm workflow.
- Review loop đối chiếu goal và baseline **mỗi vòng**; mục đích là implementation đúng hơn, **không làm workflow ngày càng dài**.
- Trước khi báo hoàn thành, Builder phải kiểm tra bản `JOB.md` thật, không chỉ bản diễn giải trong chat. Khi user yêu cầu trình bày lại, không được “lòi ra” step ngoài approval.

## 6. Nomination versus authorization

**NOMINATED ≠ APPROVED ≠ IMPLEMENTED.**

| State | Meaning | Impact on executable contract |
|---|---|---|
| `NOMINATED` | Builder/Reviewer nêu cải tiến (thêm/bỏ step, check, confirmation, recovery, business rule...) | **Không** sửa baseline/JOB.md |
| `APPROVED` | User phê duyệt nội dung cụ thể | Cho phép Builder sửa đúng phạm vi đã duyệt |
| `IMPLEMENTED` | Builder đã sửa và kiểm chứng | Chỉ bản đủ điều kiện mới có hiệu lực khi publish/activate |

Nomination phải tách khỏi execution contract để Operator không đọc nhầm đề xuất thành lệnh. **Reviewer không có quyền thay user duyệt workflow.**

## 7. Shared Runtime — enforcement, not ceremonial prompts

- **One Runtime / Registry / State & Verification layer**, không nhân đôi theo harness.
- Router chọn harness theo **user intent**; không cần user gõ Operator/Builder khi yêu cầu đủ rõ.
- Runtime cấp context và MCP/tool permissions **theo active step** (Operator) hoặc approved development scope (Builder).
- Runtime sở hữu transition, postconditions, failure policy, terminal state, run evidence và versioned executable Job.
- `JOB.md` và các artifact Job thuộc managed **Local AppData** theo canonical RevitGPT storage; Knowledge chính thức thuộc repo source. Hướng dẫn này không tự đổi storage contract hiện có.
- Không cấp cho Operator quyền write workflow; không cấp quyền phát triển chỉ vì Operator báo lỗi.

## 8. Open technical questions for P3 implementation planning

**Chưa được coi là đã hoạt động hoặc đã xác minh:**

1. **GPT Web invocation boundary:** Runtime có thực sự chủ động gọi lại cùng GPT Web model tại reasoning step hay không? Cần khảo sát giao thức/surface hiện có; không giả định có API tự động như server-side model API. Các step deterministic vẫn tự động được mà không cần suy luận model.
2. **Contract enforcement:** Thiết kế tool leasing, scoped permissions, data handoff và denial thực sự ở Runtime/MCP; không chỉ system prompt.
3. **Baseline persistence & semantic diff:** Cách lưu approved baseline, so sánh nội dung/điều kiện/substeps với `JOB.md`, phát hiện drift mà không tự tạo các gate phiền phức.
4. **Job versioning & activation:** Bản đang chạy không bị Builder thay đổi giữa chừng; bản mới chỉ được Operator dùng sau khi được cho phép chạy.
5. **Fail-fast evidence:** Lưu lỗi tool/Dynamo đủ cụ thể và stop state; không tự mở rộng recovery.
6. **Performance:** Giảm gọi model/MCP cho deterministic steps; không giới hạn cứng reasoning trong các step thực sự cần HVAC analysis.

Các mục trên là **việc cần xác minh/lập plan ở P3**, không phải lý do bổ sung bước vận hành cho Saved Job chưa được user duyệt.

## 9. P3 acceptance direction (not yet a test plan)

1. Saved Job gọi tên → Operator; Temp Job và development → Builder.
2. Operator reasoning đúng scope; Runtime tự chuyển step khi postconditions đạt.
3. Operator không thêm step/check/confirmation/recovery/workaround; tool permissions chặn ngoài hợp đồng.
4. Dynamo load/run thất bại → STOP + exact error, trừ recovery đã được duyệt.
5. Builder viết Job từ baseline user chốt → `JOB.md` không có hành vi thừa, kể cả substeps ẩn.
6. Reviewer sửa implementation defects nhưng chỉ nominate workflow improvements.
7. Nomination không sửa contract trước user approval.
8. Không dùng hai model hoặc hai agent; không cần Ollama ở P3.
9. Việc triển khai P3 không làm lệch phạm vi P1 hiện hành.

## 10. Decision summary

> **Operator executes Saved Jobs according to an approved workflow, with reasoning only where specified.**  
> **Builder develops Saved/Temp Jobs, Dynamo and MCP with deep but scoped reasoning, without unauthorized workflow expansion.**  
> **Runtime enforces execution contracts and deterministic step transitions.**  
> **User alone approves workflow changes; Builder/Reviewer may nominate but may not silently implement them.**

**Scope fence:** Tài liệu này chỉ ghi nhận định hướng kiến trúc **Agent Harness for P3**. Không thay thế roadmap/plan P1 hoặc các acceptance gate đã chốt, không tự khởi động implementation, không nâng giả định kỹ thuật thành tính năng đã verified.
