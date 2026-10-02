# x-openai-session stability test

## Mục tiêu

Đo xem cùng một ChatGPT conversation có giữ được logical identity sau khi user rời chat một thời gian rồi quay lại và reconnect plugin hay không.

Bài test **không phụ thuộc Revit** và không yêu cầu giữ chat mở liên tục.

## Cách test đúng

Mỗi mốc thời gian là một bài test continuity tự nhiên của cùng chat:

1. Mở chat cần test.
2. Connect CG/CadGPT plugin.
3. Gửi một lệnh nhẹ, ví dụ `cg/status`.
4. Ghi checkpoint `t0`.
5. Có thể rời/đóng chat.
6. Sau thời gian cần đo, mở lại **đúng chat đó**.
7. Reconnect/call plugin lại nếu cần.
8. Gửi lại một lệnh nhẹ.
9. Ghi checkpoint tương ứng.
10. So sánh logical identity trước/sau.

Không cần giữ MCP transport cũ sống. Transport rotate/reconnect là một phần của bài test.

## Các mốc Human sẽ đo

- 1 giờ
- 4 giờ
- 8 giờ

Có thể thực hiện thành ba bài độc lập hoặc cùng một chat theo chuỗi thời gian, tùy thuận tiện.

Ví dụ bài 4h:

```text
Chat A
t0:
  connect plugin
  send cg/status
  capture t0

rời chat

4h sau:
  mở lại đúng Chat A
  reconnect plugin
  send cg/status
  capture 4h

compare
```

## Lệnh capture

Khởi tạo evidence:

```bat
session-test.bat reset
```

Sau lần gọi đầu tiên:

```bat
session-test.bat capture t0
```

Sau khi quay lại cùng chat:

```bat
session-test.bat capture 1h
session-test.bat capture 4h
session-test.bat capture 8h
```

Chỉ chạy label tương ứng với bài test đang làm.

## Control chat khác

Để xác nhận hai chat khác nhau thực sự có identity khác nhau:

1. Mở chat khác.
2. Connect plugin.
3. Gửi `cg/status`.
4. Capture:

```bat
session-test.bat capture control-new-chat
```

## Report

```bat
session-test.bat report
```

Cần quan sát:

- cùng chat trước/sau idle có cùng `x-openai-session` hay không;
- `mcp-session-id` có thể đổi và điều đó không phải lỗi;
- chat khác phải có logical session khác;
- nếu `x-openai-session` đổi nhưng continuity vẫn có một identifier khác đáng tin cậy, ghi nhận để nghiên cứu tiếp.

## Evidence source

CadGPT hiện đã log fingerprint của:

- `x-openai-session`
- `x-openai-subject`
- `mcp-session-id`
- timestamp/runtime id

RevitGPT analyzer chỉ đọc các fingerprint này, không lưu raw OpenAI identity header.

## Decision gate

- Same chat giữ cùng logical identity sau 1h/4h/8h -> có evidence để dùng cho reconnect/lease refresh.
- Identity rotate nhưng có mapping continuity đáng tin -> nghiên cứu cơ chế rotate/rebind.
- Không chứng minh được continuity -> binding cũ chết và fresh-bind; không workaround bằng giả thuyết.

## Lưu ý runtime

Nếu CadGPT runtime bị restart giữa hai checkpoint, fingerprint hiện tại dùng salt theo runtime nên report không thể so trực tiếp trước/sau restart. Trường hợp đó chỉ có nghĩa **probe hiện tại chưa đủ để kết luận**, không có nghĩa ChatGPT conversation identity đã đổi.
